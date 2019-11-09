const _ = require('lodash');
const assert = require('assert');
const sinon = require('sinon');
const http = require('http');
const {server: WebSocketServer, client: WebSocketClient} = require('websocket');
const {BCServer, BCServerSector, BCServerSector2, WsConnection,
    BCClientSession} = require('../src/core/server');
const {BCClient, BCObjectFactory} = require('../src/core/client');
const {Tank} = require('../src/battle-city/tank');

describe('util', ()=>{
    describe('connection', ()=>{
        it('call', done=>{
            let clientSide, serverSide;
            class A {
                constructor(connecion, value){
                    this.connection = new WsConnection(connecion, this);
                    this.value = value;
                }
                callOtherSide(n){
                    return this.connection.call('getValue', [n]);
                }
                getValue(n){
                    return new Promise((resolve)=>{
                        setTimeout(()=>resolve(this.value+n), 1);
                    });
                };
            }
            let server = http.createServer(function(request, response){
                response.writeHead(404);
                response.end();
            });
            let wsServer = new WebSocketServer({
                httpServer: server,
                autoAcceptConnections: false,
            });
            wsServer.on('request', function(request){
                let connection = request.accept('echo-protocol', request.origin);
                serverSide = new A(connection, 'server');
            });
            server.listen(function(){
                let {port, address} = this.address();
                let client = new WebSocketClient();
                client.on('connect', async (connection)=>{
                    clientSide = new A(connection, 'client');
                    assert.deepStrictEqual(await Promise.all([
                        clientSide.callOtherSide(1),
                        clientSide.callOtherSide(2),
                        serverSide.callOtherSide(1),
                        serverSide.callOtherSide(2),
                    ]), ['server1', 'server2', 'client1', 'client2']);
                    connection.close();
                    server.close();
                    done();
                });
                client.connect(`ws://${address}:${port}/`, 'echo-protocol');
            });
        });
    });
});

class TestServer {
    constructor(sectors){
        this.server = new BCServer(sectors);
        this.httpServer = http.createServer(function(request, response){
            response.writeHead(404);
            response.end();
        });
        this.connections = [];
    }
    listen(){
        return new Promise(resolve=>{
            let wsServer = new WebSocketServer({httpServer: this.httpServer,
                autoAcceptConnections: false});
            wsServer.on('request', request=>{
                let connection = request.accept('echo-protocol', request.origin);
                this.server.createSession(connection);
            });
            this.httpServer.listen(resolve);
        });
    }
    connect(){
        return new Promise(resolve=>{
            let client = new WebSocketClient();
            client.on('connect', connection=>{
                this.connections.push(connection);
                resolve(new BCClientSession(connection));
            });
            let {port, address} = this.httpServer.address();
            client.connect(`ws://${address}:${port}/`, 'echo-protocol');
        });
    }
    close(){
        return new Promise(resolve=>{
            this.connections.map(c=>c.close());
            this.httpServer.close(()=>resolve());
        });
    }
}

describe('server', ()=>{
    let sb, test_server, sector1, sector2;
    let init = (...args)=>Promise.all(args.map(async sector=>{
        let session = await test_server.connect();
        if (sector)
            await session.sectorSubscribe(sector);
        return session;
    }));
    beforeEach(async function(){
        sb = sinon.createSandbox();
        sector1 = new BCServerSector2('1:1', 0, []);
        sector2 = new BCServerSector2('2:2', 10, [{}, {}]);
        test_server = new TestServer({'1:1': sector1, '2:2': sector2});
        await test_server.listen();
    });
    afterEach(async function(){
        await test_server.close();
        sb.verifyAndRestore();
    });
    // sector is not functional without at least 2 clients
    it('initialization', async ()=>{
        let [session1, session2] = await init(false, false);
        let promise = new Promise(resolve=>{
            session1.onStep = (...args)=>{
                assert.deepStrictEqual(args, ['1:1', 0, []]);
                resolve();
            };
        });
        sector1.step();
        assert.strictEqual(sector1.stepId, 0, 'without clients step has no effect');
        await session1.sectorSubscribe('1:1');
        sector1.step();
        assert.strictEqual(sector1.stepId, 0, '1 client still not enough to proceed');
        await session2.sectorSubscribe('1:1');
        sector1.step();
        assert.strictEqual(sector1.stepId, 1, 'sector starts stepping');
        return promise;
    });
    it('sending actions', async ()=>{
        let [session1, session2] = await init('1:1', '1:1');
        let promise = new Promise(resolve=>{
            session1.onStep = (...args)=>{
                assert.deepStrictEqual(args, ['1:1', 0,
                    [{key: 'w', sessionId: 1}, {key: 'a', sessionId: 2}]]);
                resolve();
            };
        });
        await session1.userAction('1:1', {key: 'w'});
        await session2.userAction('1:1', {key: 'a'});
        sector1.step();
        assert.strictEqual(sector1.stepId, 1, 'sector starts stepping');
        return promise;
    });
    it('normal flow', async ()=>{
        let [session1, session2] = await init('1:1', '1:1');
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 0,
            'waiting for all clients confirmations');
        await session2.confirmStep(sector1.sectorId, 0, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 1,
            'step is confirmed once all clients sent equal hashes');
    });
    it('average slow client', async ()=>{
        let [session1, session2] = await init('1:1', '1:1');
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 1, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 0,
            'waiting for all clients confirmations');
        await session2.confirmStep(sector1.sectorId, 0, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 1,
            'step is confirmed once all clients sent equal hashes');
        await session2.confirmStep(sector1.sectorId, 1, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 2,
            'step is confirmed once all clients sent equal hashes');
    });
    it('client timeout', async ()=>{
        let [session1, session2] = await init('1:1', '1:1');
        let promise = new Promise(resolve=>{
            session2.error = ()=>resolve();
        });
        sector1.maxStepDepth = 2;
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 1, 'A');
        sector1.step();
        return promise;
    });
    it('connection', async ()=>{
        let [session1, session2, session3] = await init('1:1', '1:1', false);
        sector1.step();
        let res = await session3.sectorSubscribe('1:1');
        assert.deepStrictEqual(res, {sectorId: '1:1',
            stepId: 1, objectsStepId: -1, objectsData: []});
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        await session2.confirmStep(sector1.sectorId, 0, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 1,
            'step is confirmed once all clients sent equal hashes');
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 1, 'A');
        await session2.confirmStep(sector1.sectorId, 1, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 1,
            'step is confirmed once all clients sent equal hashes');
        await session3.confirmStep(sector1.sectorId, 1, 'A');
        assert.strictEqual(sector1._oldestPendingStep(), 2,
            'step is confirmed once all clients sent equal hashes');
    });
    it('disconnection normal', async ()=>{
        let [session1, session2, session3] = await init('1:1', '1:1', '1:1');
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        await session2.confirmStep(sector1.sectorId, 0, 'A');
        await session3.sectorUnsubscribe(sector1.sectorId);
        assert.strictEqual(sector1._oldestPendingStep(), 1,
            'step is confirmed once all clients sent equal hashes');
    });
    it('disconnection + freeze', async ()=>{
        let [session1, session2] = await init('1:1', '1:1');
        sb.spy(sector1, '_callChipAndDale');
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        await session2.sectorUnsubscribe(sector1.sectorId);
        assert.strictEqual(sector1._oldestPendingStep(), 0,
            'step is confirmed once all clients sent equal hashes');
        assert(sector1._callChipAndDale.calledOnce);
    });
    it('kick user on wrong hash', async ()=>{
        let [session1, session2, session3] = await init('1:1', '1:1', '1:1');
        sector1.step();
        let promise = new Promise(resolve=>{
            session3.error = ()=>resolve();
        });
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        await session2.confirmStep(sector1.sectorId, 0, 'A');
        await session3.confirmStep(sector1.sectorId, 0, 'X');
        assert.strictEqual(sector1._oldestPendingStep(), 1,
            'step confirmed with 2 steps');
        return promise;
    });
    it('kick all users on wrong hash', async ()=>{
        let [session1, session2, session3] = await init('1:1', '1:1', '1:1');
        sector1.step();
        let promise1 = new Promise(resolve=>{ session1.error = ()=>resolve(); });
        let promise2 = new Promise(resolve=>{ session2.error = ()=>resolve(); });
        let promise3 = new Promise(resolve=>{ session3.error = ()=>resolve(); });
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        await session2.confirmStep(sector1.sectorId, 0, 'B');
        await session3.confirmStep(sector1.sectorId, 0, 'C');
        assert.strictEqual(sector1._oldestPendingStep(), 0, 'step is not confirmed');
        // todo rollback pendingSteps
        return Promise.all([promise1, promise2, promise3]);
    });
    it('sync', async ()=>{
        sector1.syncInterval = 1;
        let [session1, session2] = await init('1:1', '1:1');
        session1.getSector = (sectorId, stepId)=>({stepId, objectsData: [{a: 1}]});
        sector1.step();
        await session1.confirmStep(sector1.sectorId, 0, 'A');
        await session2.confirmStep(sector1.sectorId, 0, 'A');
        assert.strictEqual(sector1.objectsStepId, 0);
        assert.deepStrictEqual(sector1.objectsData, [{a: 1}]);
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
