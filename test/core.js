const assert = require('assert');
const BCServer = require('../src/core/server');

describe('server', ()=>{
    // player connects to the server and gets sector objects
    it('subscribe', done=>{
        let server = new BCServer({
            1: [{}, {}],
        });
        server.on('subscribe', (sectorId, objects)=>{
            assert.equal(sectorId, 1);
            assert.deepEqual(objects, [{}, {}]);
            done();
        });
        server.subscribe([1]);
    });
    // second player receives events from first player
    it('sync 2 clients', done=>{
        let server = new BCServer({
            1: [{}, {}],
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
});
