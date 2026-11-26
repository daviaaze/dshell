/** Keep password type-ahead within the first secret question of one PAM conversation. */
export class PromptSubmission {
    #firstPrompt = true;
    #queuedPassword: string | null = null;

    queuePassword(answer: string): void {
        if (this.#firstPrompt && answer !== '') this.#queuedPassword = answer;
    }

    receivePrompt(visible: boolean): string | null {
        const answer = this.#firstPrompt && !visible ? this.#queuedPassword : null;
        this.#firstPrompt = false;
        this.#queuedPassword = null;
        return answer;
    }

    reset(): void {
        this.#firstPrompt = true;
        this.#queuedPassword = null;
    }
}
