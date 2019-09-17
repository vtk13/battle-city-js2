const assert = require('assert');
const sinon = require('sinon');
const {BCServer, BCServerSector} = require('../src/core/server');
const {BCClient, BCObjectFactory} = require('../src/core/client');
const {Tank} = require('../src/battle-city/tank');

describe('server', ()=>{
    let server;
    beforeEach(()=>{
        server = new BCServer({
            1: new BCServerSector(1, 234, [{}, {}]),
        });
    });
    it('player connects to the server and gets sector objects', done=>{
        let session = server.createSession();
        session.subscribe([1], (sectorId, stepId, objects)=>{
            assert.strictEqual(sectorId, 1);
            assert.strictEqual(stepId, 234);
            assert.deepStrictEqual(objects, [{}, {}]);
            done();
        });
    });
    // todo send actions to other sectors
    it('step is emitted once all player sent actions', done=>{
        let session1 = server.createSession();
        let session2 = server.createSession();
        session2.on('step', (sectorId, stepId, userActions)=>{
            assert.strictEqual(sectorId, 1);
            assert.strictEqual(stepId, 234);
            assert.deepStrictEqual(userActions,
                [{key: 'w', sessionId: 1}, {key: 'a', sessionId: 2}]);
            done();
        });
        session1.subscribe([1]);
        session2.subscribe([1]);
        session1.step(1, 234, 'A', [{key: 'w'}]);
        session2.step(1, 234, 'A', [{key: 'a'}]);
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
        session1.step(1, 234, 'A', [{key: 'w'}]);
        session2.step(1, 234, 'A', [{key: 's'}]);
    });
    it('player receives actual objects on connect', done=>{
        let session1 = server.createSession();
        session1.on('getSector', sectorId=>{
            session1.setSector(sectorId, 235, [{}, {}, {}]);
        });
        session1.subscribe([1]);
        session1.step(1, 234, 'A', [{key: 'w'}]);

        let session2 = server.createSession();
        session2.subscribe([1], (sectorId, stepId, objects)=>{
            assert.strictEqual(stepId, 235);
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
        session1.step(1, 234, 'A', []);
        session2.step(1, 234, 'A', []);
        session2.unsubscribe([1]);
        session1.step(1, 235, 'A', []);
        // todo: ensure step is done
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
        session1.step(1, 234, 'A', []);
        session2.step(1, 234, 'B', []);
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
        session1.step(1, 234, 'B', []);
        session2.step(1, 234, 'B', []);
        session3.step(1, 234, 'X', []);
    });
});

describe('client', ()=>{
    let server, factory, sectorId = 1;
    beforeEach(()=>{
        factory = new BCObjectFactory();
        factory.register('tank', Tank);
        let tank = factory.makeObject({className: 'tank', sessionId: 1, x: 0, y: 0});
        server = new BCServer({
            [sectorId]: new BCServerSector(sectorId, 0, [tank]),
        });
    });
    it('simple', ()=>{
        let client1 = new BCClient(server.createSession(), factory);
        client1.subscribe([sectorId]);
        let client2 = new BCClient(server.createSession(), factory);
        client2.subscribe([sectorId]);
        sinon.assert.match(client1.sectors[sectorId].objects[0],
            sinon.match({className: 'tank', x: 0, y: 0}));
        assert.deepStrictEqual();
        client1.action(sectorId, {key: 'w'});
        client1.completeStep(sectorId);
        client2.completeStep(sectorId);
        sinon.assert.match(client1.sectors[sectorId].objects[0],
            sinon.match({className: 'tank', x: 0, y: -10}));
        sinon.assert.match(client2.sectors[sectorId].objects[0],
            sinon.match({className: 'tank', x: 0, y: -10}));
    });
    it('client gets actual state from another client', ()=>{
        let client1 = new BCClient(server.createSession(), factory);
        client1.subscribe([sectorId]);
        client1.action(sectorId, {key: 'w'});
        client1.completeStep(sectorId);
        let client2 = new BCClient(server.createSession(), factory);
        client2.subscribe([sectorId]);
        sinon.assert.match(client2.sectors[sectorId].objects[0],
            sinon.match({className: 'tank', x: 0, y: -10}));
    });
    describe('loading sectors', ()=>{
        it('pub sub', ()=>{
            let client = new BCClient(server.createSession(), factory);
            sinon.stub(client.session, 'subscribe')
                .callsFake((sectorIds, onSubscribed)=>{
                    sectorIds.map(id=>onSubscribed(id, 0, []));
                });
            client.setCamXY(0, 0);
            assert.deepStrictEqual(Object.keys(client.sectors), ['0:0', '-1:0', '-1:-1', '0:-1']);
            client.setCamXY(300, 300);
            assert.deepStrictEqual(Object.keys(client.sectors), ['0:0', '1:1', '0:1', '1:0']);
        });

    });
});
