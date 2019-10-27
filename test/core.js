const _ = require('lodash');
const assert = require('assert');
const sinon = require('sinon');
const {BCServer, BCServerSector, BCServerSector2} = require('../src/core/server');
const {BCClient, BCObjectFactory} = require('../src/core/client');
const {Tank} = require('../src/battle-city/tank');

describe('server', ()=>{
    let sb;
    beforeEach(()=>{ sb = sinon.createSandbox(); });
    afterEach(()=>sb.verifyAndRestore());
    describe('old test to be reviewed', ()=>{
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
            session3.on('error', ()=>done());
            session1.step(1, 234, 'B', []);
            session2.step(1, 234, 'B', []);
            session3.step(1, 234, 'X', []);
        });
    });
    describe('BCServerSector2', ()=>{
        // todo: refactor sector.connect() calls to session.subscribe()
        let sector, server;
        beforeEach(()=>{
            sector = new BCServerSector2();
            server = new BCServer({'0:0': sector});
        });
        let init = (...args)=>args.map(connected=>{
            let session = server.createSession();
            if (connected)
                sector.connect(session);
            return session;
        });
        // sector is not functional without at least 2 clients
        it('initialization', ()=>{
            let [session1, session2] = init(false, false);
            sb.spy(session1, 'onStep');
            server.step2();
            assert.strictEqual(sector.stepId, 0, 'without clients step has no effect');
            sector.connect(session1);
            sector.step();
            assert.strictEqual(sector.stepId, 0, '1 client still not enough to proceed');
            sector.connect(session2);
            sector.step();
            assert.strictEqual(sector.stepId, 1, 'sector starts stepping');
            assert(session1.onStep.calledOnceWith('0:0', 0, []));
        });
        it('sending actions', ()=>{
            let [session1, session2] = init(true, true);
            sb.spy(session1, 'onStep');
            session1.userAction('0:0', {key: 'w'});
            session2.userAction('0:0', {key: 'a'});
            sector.step();
            assert.strictEqual(sector.stepId, 1, 'sector starts stepping');
            assert(session1.onStep.calledOnceWith('0:0', 0,
                [{key: 'w', sessionId: 1}, {key: 'a', sessionId: 2}]));
        });
        it('normal flow', ()=>{
            let [session1, session2] = init(true, true);
            sector.step();
            session1.confirmStep(sector.sectorId, 0, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 0,
                'waiting for all clients confirmations');
            session2.confirmStep(sector.sectorId, 0, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 1,
                'step is confirmed once all clients sent equal hashes');
        });
        it('average slow client', ()=>{
            let [session1, session2] = init(true, true);
            sector.step();
            session1.confirmStep(sector.sectorId, 0, 'A');
            sector.step();
            session1.confirmStep(sector.sectorId, 1, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 0,
                'waiting for all clients confirmations');
            session2.confirmStep(sector.sectorId, 0, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 1,
                'step is confirmed once all clients sent equal hashes');
            session2.confirmStep(sector.sectorId, 1, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 2,
                'step is confirmed once all clients sent equal hashes');
        });
        it('client timeout', done=>{
            let [session1, session2] = init(true, true);
            session2.on('error', ()=>done());
            sector.maxStepDepth = 2;
            sector.step();
            session1.confirmStep(sector.sectorId, 0, 'A');
            sector.step();
            session1.confirmStep(sector.sectorId, 1, 'A');
            sector.step();
        });
        it('connection', ()=>{
            let [session1, session2, session3] = init(true, true, false);
            sector.step();
            sector.connect(session3);
            session1.confirmStep(sector.sectorId, 0, 'A');
            session2.confirmStep(sector.sectorId, 0, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 1,
                'step is confirmed once all clients sent equal hashes');
            sector.step();
            session1.confirmStep(sector.sectorId, 1, 'A');
            session2.confirmStep(sector.sectorId, 1, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 1,
                'step is confirmed once all clients sent equal hashes');
            session3.confirmStep(sector.sectorId, 1, 'A');
            assert.strictEqual(sector._oldestPendingStep(), 2,
                'step is confirmed once all clients sent equal hashes');
        });
        it('disconnection', ()=>{
            let [session1, session2, session3] = init(true, true, true);
            sector.step();
            session1.confirmStep(sector.sectorId, 0, 'A');
            session2.confirmStep(sector.sectorId, 0, 'A');
            session3.sectorUnsubscribe(sector.sectorId);
            assert.strictEqual(sector._oldestPendingStep(), 1,
                'step is confirmed once all clients sent equal hashes');
        });
        it('disconnection + freeze', ()=>{
            let [session1, session2] = init(true, true);
            sb.spy(sector, '_callChipAndDale');
            sector.step();
            session1.confirmStep(sector.sectorId, 0, 'A');
            session2.sectorUnsubscribe(sector.sectorId);
            assert.strictEqual(sector._oldestPendingStep(), 0,
                'step is confirmed once all clients sent equal hashes');
            assert(sector._callChipAndDale.calledOnce);
        });
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
            // moving command received on this step
            client1.completeStep();
            // object moves and migration command is sent to sector2
            client1.completeStep();
            assert.deepStrictEqual(client1.sectors[sector1].objects, []);
            // sector2 receives and executes migration
            client1.completeStep();
            // another step to verify migrate event received only once
            client1.completeStep();
            assert.strictEqual(client1.sectors[sector2].objects.length, 1);
            sinon.assert.match(client1.sectors[sector2].objects, [sinon.match({x: 5, y: -25})]);
        });
    });
});
