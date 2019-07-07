const assert = require('assert');
const {BCServer, BCSector} = require('../src/core/server');

describe('server', ()=>{
    it('player connects to the server and gets sector objects', done=>{
        let server = new BCServer({
            1: new BCSector(0, [{}, {}]),
        });
        let session = server.createSession();
        // TODO: add dataStepId
        session.on('subscribe', (sectorId, objects)=>{
            assert.equal(sectorId, 1);
            assert.deepEqual(objects, [{}, {}]);
            done();
        });
        session.subscribe([1]);
    });
    it('second player receives events from first player', done=>{
        let server = new BCServer({
            1: new BCSector(0, [{}, {}]),
        });
        let session1 = server.createSession();
        let session2 = server.createSession();
        session2.on('step', (stepId, sectorId, userActions)=>{
            assert.equal(stepId, 234);
            assert.equal(sectorId, 1);
            assert.deepEqual(userActions, [{key: 'w'}]);
            done();
        });
        session1.step(234, 1, 'A', [{key: 'w'}]);
    });
    it('players receive the same step events for each player', done=>{
        let server = new BCServer({
            1: new BCSector(0, [{}, {}]),
        });
        let session1 = server.createSession();
        let session2 = server.createSession();
        let n = 0;
        session1.on('step', ()=>{
            if (++n==2)
                done();
        });
        session1.step(234, 1, 'A', [{key: 'w'}]);
        session2.step(234, 1, 'A', [{key: 's'}]);
    });
    it('player receives actual data on connect', ()=>{
        let server = new BCServer({
            1: new BCSector(0, [{}, {}]),
        });
        let session1 = server.createSession();
        session1.on('getSector', sectorId=>{
            session1.setSector(sectorId, 234, [{}, {}, {}]);
        });
        session1.subscribe([1]);
        session1.step(234, 1, 'A', [{key: 'w'}]);

        let session2 = server.createSession();
        session2.on('subscribe', (sectorId, objects)=>{
            assert.deepEqual(objects, [{}, {}, {}]);
            done();
        });
        session2.subscribe([1]);
    });
});
