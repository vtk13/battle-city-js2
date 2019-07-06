const assert = require('assert');

let BCServer = require('../src/core/server');
describe('server', ()=>{
    // player connects to the server and gets sector objects
    it('subscribe', done=>{
        let server = new BCServer();
        server.on('subscribe', (sectorId, objects)=>{
            assert.equal(sectorId, 1);
            assert.deepEqual(objects, [{}, {}]);
            done();
        });
        server.subscribe([1]);
    });
});
