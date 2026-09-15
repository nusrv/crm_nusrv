import { classifySmtpError } from './smtp-error-classification';

describe('classifySmtpError — precedence', () => {
  it('EAUTH with a 5xx-looking responseCode (535) classifies as infrastructure, never message-specific', () => {
    const error = { code: 'EAUTH', command: 'AUTH', responseCode: 535, response: '535 authentication failed' };
    expect(classifySmtpError(error)).toEqual({ terminal: false, healthImpact: 'infrastructure' });
  });

  it('ECONNECTION classifies as infrastructure', () => {
    expect(classifySmtpError({ code: 'ECONNECTION' })).toEqual({ terminal: false, healthImpact: 'infrastructure' });
  });

  it('ETIMEDOUT classifies as infrastructure (transient, bounded retry)', () => {
    expect(classifySmtpError({ code: 'ETIMEDOUT' })).toEqual({ terminal: false, healthImpact: 'infrastructure' });
  });

  it('a RCPT TO 550 is a permanent, message-specific, terminal failure', () => {
    const error = { command: 'RCPT TO', responseCode: 550, response: '550 no such user' };
    expect(classifySmtpError(error)).toEqual({ terminal: true, healthImpact: 'message' });
  });

  it('a RCPT TO 450 is a retryable, message-specific, non-terminal failure (no global UNAVAILABLE)', () => {
    const error = { command: 'RCPT TO', responseCode: 450, response: '450 mailbox temporarily unavailable' };
    expect(classifySmtpError(error)).toEqual({ terminal: false, healthImpact: 'message' });
  });

  it('a DATA 550 is a terminal, message-specific failure', () => {
    const error = { command: 'DATA', responseCode: 550, response: '550 message rejected' };
    expect(classifySmtpError(error)).toEqual({ terminal: true, healthImpact: 'message' });
  });

  it('a permanent MAIL FROM rejection classifies as configuration/sender (infrastructure), not a bad recipient', () => {
    const error = { command: 'MAIL FROM', responseCode: 553, response: '553 sender address rejected' };
    expect(classifySmtpError(error)).toEqual({ terminal: false, healthImpact: 'infrastructure' });
  });

  it('nodemailer EENVELOPE/EMESSAGE (no SMTP round trip) is terminal and message-specific', () => {
    expect(classifySmtpError({ code: 'EENVELOPE' })).toEqual({ terminal: true, healthImpact: 'message' });
    expect(classifySmtpError({ code: 'EMESSAGE' })).toEqual({ terminal: true, healthImpact: 'message' });
  });

  it('an unknown/unclassified error fails safely: bounded retry, no health conclusion', () => {
    expect(classifySmtpError(new Error('boom'))).toEqual({ terminal: false, healthImpact: 'none' });
    expect(classifySmtpError('a string, not an Error')).toEqual({ terminal: false, healthImpact: 'none' });
    expect(classifySmtpError(null)).toEqual({ terminal: false, healthImpact: 'none' });
    expect(classifySmtpError({ command: 'RCPT TO' })).toEqual({ terminal: false, healthImpact: 'none' }); // no responseCode at all
  });

  it('EAUTH still wins even when paired with a RCPT-stage-looking command (precedence, not coincidence)', () => {
    // Contrived combination to prove rule A is checked first and unconditionally, not merely
    // because EAUTH errors never carry a `command` in practice.
    const error = { code: 'EAUTH', command: 'RCPT TO', responseCode: 550 };
    expect(classifySmtpError(error)).toEqual({ terminal: false, healthImpact: 'infrastructure' });
  });
});
