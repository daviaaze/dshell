import {DesktopAlertPublisher} from '../notifications/systemAlerts';
import type {AlertNotification, SystemAlert} from '../notifications/alerts';
import {describe, expect, it, run} from './test-runner';

const low: SystemAlert = {key: 'battery', kind: 'battery-low', percentage: 20};
const critical: SystemAlert = {key: 'battery', kind: 'battery-critical', percentage: 10};

describe('desktop alert replacement', () => {
    it('waits for the server ID before sending a critical same-key update', async () => {
        const calls: {content: AlertNotification; replaces: number}[] = [];
        const reply = Promise.withResolvers<number>();
        const publisher = new DesktopAlertPublisher((content, replaces) => {
            calls.push({content, replaces});
            if (calls.length === 1) return reply.promise;
            return Promise.resolve(41);
        });
        const first = publisher.publish(low);
        const second = publisher.publish(critical);
        await Promise.resolve();
        await Promise.resolve();
        expect(calls.length).toBe(1);
        expect(calls[0].replaces).toBe(0);
        reply.resolve(41);
        await first;
        await second;
        expect(calls[1].replaces).toBe(41);
        expect(calls[1].content.urgency).toBe(2);
    });

    it('does not mix replacement IDs across alert keys', async () => {
        const replaces: number[] = [];
        let nextId = 10;
        const publisher = new DesktopAlertPublisher((_content, id) => {
            replaces.push(id);
            return Promise.resolve(nextId++);
        });
        await publisher.publish(low);
        await publisher.publish({key: 'temperature', kind: 'temperature-warning', temperatureC: 80});
        await publisher.publish(critical);
        expect(replaces).toEqual([0, 0, 10]);
    });

    it('recovers after a failed Notify without inventing an ID or blocking later alerts', async () => {
        let attempts = 0;
        const replaces: number[] = [];
        const publisher = new DesktopAlertPublisher((_content, id) => {
            replaces.push(id);
            if (++attempts === 1) return Promise.reject(new Error('daemon unavailable'));
            return Promise.resolve(12);
        });
        let rejected = false;
        try { await publisher.publish(low); } catch { rejected = true; }
        expect(rejected).toBe(true);
        await publisher.publish(critical);
        expect(replaces).toEqual([0, 0]);
    });

    it('forgets stale IDs when the notification daemon changes', async () => {
        const replaces: number[] = [];
        const publisher = new DesktopAlertPublisher((_content, id) => {
            replaces.push(id);
            return Promise.resolve(12);
        });
        await publisher.publish(low);
        publisher.reset();
        await publisher.publish(critical);
        expect(replaces).toEqual([0, 0]);
    });
});

await run();
