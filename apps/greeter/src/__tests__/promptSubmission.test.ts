import {PromptSubmission} from '../greeter-ui/promptSubmission';
import {describe, expect, it, run} from './test-runner';

describe('PromptSubmission', () => {
    it('allows an early Enter for the first secret prompt only', () => {
        const submission = new PromptSubmission();
        submission.queuePassword('first password');
        expect(submission.receivePrompt(false)).toBe('first password');
        expect(submission.receivePrompt(false)).toBe(null);
    });

    it('never sends a queued password to an echoed prompt', () => {
        const submission = new PromptSubmission();
        submission.queuePassword('private password');
        expect(submission.receivePrompt(true)).toBe(null);
        expect(submission.receivePrompt(false)).toBe(null);
    });

    it('does not replay text typed between later authentication prompts', () => {
        const submission = new PromptSubmission();
        expect(submission.receivePrompt(false)).toBe(null);
        submission.queuePassword('text for the previous prompt');
        expect(submission.receivePrompt(false)).toBe(null);
        expect(submission.receivePrompt(true)).toBe(null);
    });

    it('drops queued input on Back, account change or retry', () => {
        const submission = new PromptSubmission();
        submission.queuePassword('old account password');
        submission.reset();
        expect(submission.receivePrompt(false)).toBe(null);
        submission.reset();
        submission.queuePassword('new account password');
        expect(submission.receivePrompt(false)).toBe('new account password');
    });

    it('does not queue an empty answer', () => {
        const submission = new PromptSubmission();
        submission.queuePassword('');
        expect(submission.receivePrompt(false)).toBe(null);
    });
});

await run(import.meta.url);
