const assert = require('assert');
const {BCServer, BCServerSector} = require('../src/core/server');

describe('server', ()=>{
    let server;
    beforeEach(()=>{
        server = new BCServer({
            1: new BCServerSector(0, [{}, {}]),
        });
    });
    it('player connects to the server and gets sector objects', done=>{
        let session = server.createSession();
        session.subscribe([1], (sectorId, objects)=>{
            assert.strictEqual(sectorId, 1);
            assert.deepStrictEqual(objects, [{}, {}]);
            done();
        });
    });
    it('second player receives events from first player', done=>{
        let session1 = server.createSession();
        let session2 = server.createSession();
        session2.on('step', (stepId, sectorId, userActions)=>{
            assert.strictEqual(stepId, 234);
            assert.strictEqual(sectorId, 1);
            assert.deepStrictEqual(userActions, [{key: 'w'}]);
            done();
        });
        session2.subscribe([1]);
        session1.step(234, 1, 'A', [{key: 'w'}]);
    });
    it('players receive the same step events for each player', done=>{
        let session1 = server.createSession();
        let session2 = server.createSession();
        let n = 0;
        session1.on('step', ()=>{
            if (++n===2)
                done();
        });
        session1.subscribe([1]);
        session1.step(234, 1, 'A', [{key: 'w'}]);
        session2.step(234, 1, 'A', [{key: 's'}]);
    });
    it('player receives actual data on connect', ()=>{
        let session1 = server.createSession();
        session1.on('getSector', sectorId=>{
            session1.setSector(sectorId, 234, [{}, {}, {}]);
        });
        session1.subscribe([1]);
        session1.step(234, 1, 'A', [{key: 'w'}]);

        let session2 = server.createSession();
        session2.subscribe([1], (sectorId, objects)=>{
            assert.deepStrictEqual(objects, [{}, {}, {}]);
            done();
        });
    });
    it('player is unsubscribed', ()=>{
        let session1 = server.createSession();
        session1.subscribe([1]);
        let session2 = server.createSession();
        session2.subscribe([1]);
        let called = 0;
        session2.on('step', ()=>{
            called++;
        });
        session1.step(234, 1, 'A', [{key: 'w'}]);

        session2.unsubscribe([1]);
        session1.step(235, 1, 'A', [{key: 'w'}]);
        assert.strictEqual(called, 1);
    });
    it('kick all users on wrong hash', done=>{
        let n = 0;
        let onError = ()=>{
            n++;
            if (n===2)
                done();
        };
        let session1 = server.createSession();
        session1.subscribe([1]);
        session1.on('error', onError);
        let session2 = server.createSession();
        session2.subscribe([1]);
        session2.on('error', onError);
        session1.step(234, 1, 'A', []);
        session2.step(234, 1, 'B', []);
    });
    it('kick user on wrong hash', done=>{
        let session1 = server.createSession();
        session1.subscribe([1]);
        session1.on('error', ()=>assert(false));
        let session2 = server.createSession();
        session2.subscribe([1]);
        session2.on('error', ()=>assert(false));
        let session3 = server.createSession();
        session3.subscribe([1]);
        session3.on('error', done);
        session1.step(234, 1, 'B', []);
        session2.step(234, 1, 'B', []);
        session3.step(234, 1, 'X', []);
    });
});
