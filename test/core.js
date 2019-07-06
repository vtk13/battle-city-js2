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
});
