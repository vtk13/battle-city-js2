const _ = require('lodash');
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
    let server, factory, sector1 = '0:0', sector2 = '0:-1';
    beforeEach(()=>{
        factory = new BCObjectFactory();
        factory.register('tank', Tank);
        server = new BCServer({
            [sector1]: new BCServerSector(sector1, 0,
                [{className: 'tank', sessionId: 1, x: 5, y: 5}]),
            [sector2]: new BCServerSector(sector2, 0, []),
        });
    });
    it('simple', ()=>{
        let client1 = new BCClient(server.createSession(), factory);
        client1.subscribe([sector1]);
        let client2 = new BCClient(server.createSession(), factory);
        client2.subscribe([sector1]);
        sinon.assert.match(client1.sectors[sector1].objects[0],
            sinon.match({className: 'tank', x: 5, y: 5}));
        assert.deepStrictEqual();
        client1.action(sector1, {key: 'w'});
        client1.completeStep(sector1);
        client2.completeStep(sector1);
        sinon.assert.match(client1.sectors[sector1].objects[0],
            sinon.match({className: 'tank', x: 5, y: 15}));
        sinon.assert.match(client2.sectors[sector1].objects[0],
            sinon.match({className: 'tank', x: 5, y: 15}));
    });
    it('client gets actual state from another client', ()=>{
        let client1 = new BCClient(server.createSession(), factory);
        client1.subscribe([sector1]);
        client1.action(sector1, {key: 'w'});
        client1.completeStep(sector1);
        let client2 = new BCClient(server.createSession(), factory);
        client2.subscribe([sector1]);
        sinon.assert.match(client2.sectors[sector1].objects[0],
            sinon.match({className: 'tank', x: 5, y: 15}));
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
    describe('object migration', ()=>{
        it('simple', ()=>{
            let client1 = new BCClient(server.createSession(), factory);
            client1.subscribe([sector1, sector2]);
            client1.action(sector1, {key: 's'});
            client1.completeStep();
            client1.completeStep();
            assert.deepStrictEqual(client1.sectors[sector1].objects, []);
            sinon.assert.match(client1.sectors[sector2].objects[0], sinon.match({x: 5, y: -15}));
        });
    });
});
