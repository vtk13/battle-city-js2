const _ = require('lodash');
const EventEmitter = require('events');

function allEqual(obj){
    let arr = Object.values(obj);
    return arr.length && _.every(arr, v=>v==arr[0]);
}

class WsConnection {
    constructor(transport, object){
        WsConnection.callId = WsConnection.callId||1;
        this.transport = transport;
        this.object = object;
        if (!object)
            console.trace();
        this.pending = {};
        transport.on('message', async message=>{
            let msg = JSON.parse(message.utf8Data);
            if (msg.call)
            {
                let data = await this.object[msg.call](...msg.args||[]);
                transport.sendUTF(JSON.stringify({id: msg.id, data}));
            }
            else if (msg.id)
            {
                if (!(msg.id in this.pending))
                    return void console.log('slow finished', msg);
                this.pending[msg.id](msg);
                delete this.pending[msg.id];
            }
        });
    }
    call(func, args){
        return new Promise((resolve, reject)=>{
            let callId = WsConnection.callId++;
            let timerId = setTimeout(()=>{
                delete this.pending[callId];
                reject('timeout');
            }, 2000);
            let msg = JSON.stringify({call: func, id: callId, args});
            this.transport.sendUTF(msg);
            this.pending[callId] = msg=>{
                clearTimeout(timerId);
                resolve(msg.data);
            }
        });
    }
}

class BCClientSession {
    constructor(connection){
        this.connection = new WsConnection(connection, this);
    }
    /**
     * @param sectorIds
     * @param onSubscribed function(sectorId, stepId, objects)
     * @deprecated
     */
    subscribe(sectorIds, onSubscribed){
        this.server.subscribe(sectorIds, (sectorId, stepId, objects)=>{
            objects = JSON.parse(JSON.stringify(objects));
            onSubscribed && onSubscribed(sectorId, stepId, objects);
        }, this);
    }
    /**
     * @param sectorId
     * @return {sectorId, stepId, objects}
     */
    sectorSubscribe(sectorId){
        return this.connection.call('sectorSubscribe', [sectorId]);
    }
    /**
     * @param sectorIds
     * @param onUnsubscribe function(sectorId)
     */
    unsubscribe(sectorIds, onUnsubscribe){
        this.server.unsubscribe(sectorIds, this, onUnsubscribe);
    }
    sectorUnsubscribe(sectorId){
        return this.connection.call('sectorUnsubscribe', [sectorId]);
    }
    step(sectorId, stepId, hash, userActions){
        userActions = userActions.map(action=>{
            action.sessionId = this.id;
            return action;
        });
        this.server.step(sectorId, stepId, hash, userActions, this);
    }
    userAction(sectorId, userAction){
        return this.connection.call('userAction', [sectorId, userAction]);
    }
    confirmStep(sectorId, stepId, hash){
        return this.connection.call('confirmStep', [sectorId, stepId, hash]);
    }
    setSector(sectorId, objectsStepId, objects){
        this.server.setSector(sectorId, objectsStepId, objects);
    }
    // asks client to get sector data
    // client is expected to call setSector once received the message
    getSector(sectorId){
        // todo
    }
    // it is time to process another step
    onStep(sectorId, stepId, userActions){
        // todo return confirmStep()?
    }
    error(msg){
        // todo
    }
}

class BCServerSession {
    constructor(id, connection, server){
        this.id = id;
        this.connection = new WsConnection(connection, this);
        this.server = server;
    }
    /**
     * @param sectorIds
     * @param onSubscribed function(sectorId, stepId, objects)
     * @deprecated
     */
    subscribe(sectorIds, onSubscribed){
        this.server.subscribe(sectorIds, (sectorId, stepId, objects)=>{
            objects = JSON.parse(JSON.stringify(objects));
            onSubscribed && onSubscribed(sectorId, stepId, objects);
        }, this);
    }
    /**
     * @param sectorId
     * @param onSubscribed function(sectorId, stepId, objects)
     */
    sectorSubscribe(sectorId, onSubscribed){
        return this.server.sectorSubscribe(sectorId, this);
    }
    /**
     * @param sectorIds
     * @param onUnsubscribe function(sectorId)
     */
    unsubscribe(sectorIds, onUnsubscribe){
        this.server.unsubscribe(sectorIds, this, onUnsubscribe);
    }
    sectorUnsubscribe(sectorId){
        this.server.sectorUnsubscribe(sectorId, this.id);
    }
    step(sectorId, stepId, hash, userActions){
        userActions = userActions.map(action=>{
            action.sessionId = this.id;
            return action;
        });
        this.server.step(sectorId, stepId, hash, userActions, this);
    }
    userAction(sectorId, userAction){
        userAction.sessionId = this.id;
        this.server.userAction(sectorId, userAction);
    }
    confirmStep(sectorId, stepId, hash){
        return this.server.confirmStep(sectorId, this, stepId, hash);
    }
    setSector(sectorId, objectsStepId, objects){
        this.server.setSector(sectorId, objectsStepId, objects);
    }
    // asks client to get actual sector data
    getSector(sectorId){
        return this.connection.call('getSector', [sectorId]);
    }
    // it is time to process another step
    onStep(sectorId, stepId, userActions){
        return this.connection.call('onStep', [sectorId, stepId, userActions]);
    }
    error(msg){
        return this.connection.call('error', [msg]);
    }
}

class BCServerSector2 {
    constructor(sectorId = '0:0', stepId = 0, objectsData = {}){
        this.sectorId = sectorId;
        // current step id
        // increased after step is done
        this.stepId = stepId;
        // stepId of objects snapshot (stepId+1)
        // objects are not synced every step
        this.objectsStepId = stepId;
        // latest available version of objects
        // data for objectsStepId
        this.objectsData = objectsData;
        this.sessions = [];
        this.maxStepDepth = 10;
        this.syncInterval = 30;
        this.pendingSteps = {};
        this.userActions = [];
    }
    async connect(session){
        this.sessions.push(session);
        return _.pick(this, ['sectorId', 'stepId', 'objectsStepId', 'objectsData']);
    }
    /**
     *
     * @param sessionId
     * @param error
     * @returns object {[stepId]: 1} steps to process again
     */
    _disconnect(sessionId, error){
        let session;
        this.sessions = _.filter(this.sessions, s=>{
            if (s.id!=sessionId)
                return true;
            session = s;
            return false;
        });
        if (error)
            session.error(error);
        let stepsToProcess = {};
        for (let stepId in this.pendingSteps)
        {
            let step = this.pendingSteps[stepId];
            if (step.confirmed)
                continue;
            delete step.hashes[sessionId];
            stepsToProcess[stepId] = 1;
        }
        return stepsToProcess;
    }
    disconnect(sessionId, error){
        this._processHashesCycle(this._disconnect(sessionId, error));
    }
    _processHashesCycle(stepsToProcess){
        let stepId;
        while ((stepId = Object.keys(stepsToProcess||{})[0])) {
            delete stepsToProcess[stepId];
            for (let anotherStepId in this._processHashes(stepId)||{})
                stepsToProcess[anotherStepId] = 1;
        }
    }
    _step(){
        if (this.sessions.length<2)
            return;
        this.pendingSteps[this.stepId] = {
            stepId: this.stepId,
            confirmed: false,
            hashes: this.sessions.reduce((acc, session)=>{
                acc[session.id] = undefined;
                return acc;
            }, {}),
            userActions: this.userActions,
        };
        for (let session of this.sessions)
            session.onStep(this.sectorId, this.stepId, this.userActions);
        this.userActions = [];
        this.stepId++;
        let stepsToProcess = {};
        if (_.filter(this.pendingSteps, {confirmed: false}).length>this.maxStepDepth)
        {
            let step = _.find(this.pendingSteps, {confirmed: false});
            for (let sessionId in step.hashes)
                if (!step.hashes[sessionId])
                    Object.assign(stepsToProcess, this._disconnect(sessionId, 'timeout'));
        }
        return stepsToProcess;
    }
    step(){
        this._processHashesCycle(this._step());
    }
    async confirmStep(session, stepId, hash){
        if (!(stepId in this.pendingSteps))
            throw new Error('Invalid stepId');
        let step = this.pendingSteps[stepId];
        if (!(session.id in step.hashes))
            throw new Error('Unexpected session');
        step.hashes[session.id] = hash;
        this._processHashesCycle(this._processHashes(stepId));
        if (step.confirmed)
            if (_.filter(this.pendingSteps, {confirmed: true}).length>=this.syncInterval)
                await this._syncObjects();
    }
    addAction(action){
        this.userActions.push(action);
    }
    _processHashes(stepId){
        let step = this.pendingSteps[stepId];
        if (!_.every(step.hashes, Boolean))
            return;
        if (_.keys(step.hashes).length<2)
        {
            this._callChipAndDale();
            return;
        }
        if (allEqual(step.hashes))
        {
            step.confirmed = true;
            return;
        }
        let hashes = _.reduce(step.hashes, (acc, hash, sessionId)=>{
            acc[hash] = acc[hash]||[];
            acc[hash].push(sessionId);
            return acc;
        }, {});
        hashes = _.orderBy(Object.entries(hashes), '1.length', 'desc');
        let [hash, sessions] = hashes[0];
        let disconnector = err=>sessionId=>this._disconnect(sessionId, err);
        let stepsToProcess = {};
        if (sessions.length<2)
            Object.assign(stepsToProcess, sessions.map(disconnector('no majority')));
        for (let i=1; i<hashes.length; i++)
        {
            [hash, sessions] = hashes[i];
            Object.assign(stepsToProcess, sessions.map(disconnector('wrong hash')));
        }
        return stepsToProcess;
    }
    async _syncObjects(){
        let res = await this.sessions[0].getSector(this.sectorId);
        console.log("RRR", res, this.pendingSteps);
    }
    _checkHash(objectsData, hash){
        // todo implement hashing
        return true;
    }
    _oldestPendingStep(){
        let step = _.find(this.pendingSteps, {confirmed: false});
        return step ? step.stepId : this.stepId;
    }
    _callChipAndDale(){
        // todo
    }
}

class BCServerSector {
    constructor(sectorId, stepId, objectsData){
        this.sectorId = sectorId;
        // current step id
        // increased after step is done
        this.stepId = stepId;
        // stepId of objects snapshot
        // objects are not synced every step
        this.objectsStepId = stepId;
        // latest available version of objects
        // data for objectsStepId
        // todo rename to this.objectsData
        this.objects = objectsData;
        this.sessions = {};
        this.awaitingCallbacks = [];
        this.lastSteps = {};
    }
    _getStep(stepId){
        if (!this.lastSteps[stepId])
            this.lastSteps[stepId] = {n: 0, hashes: {}, userActions: []};
        return this.lastSteps[stepId];
    }
    // todo test new connection then step for previous connection
    //      ls.n will never be equal to sessions.length
    step(session, stepId, hash, userActions){
        let step = this._getStep(stepId);
        step.hashes[hash] = step.hashes[hash] || [];
        step.hashes[hash].push(session);
        step.userActions.push(...userActions.filter(a=>a.key!=='migrate'));
        step.n++;
        // TODO: optimize Object.keys
        if (step.n < Object.keys(this.sessions).length)
            return false;
        let hashes = Object.entries(step.hashes).sort((a, b)=>b[1].length-a[1].length);
        if (hashes.length>1){
            if (hashes[0][1].length===hashes[1][1].length){
                for (let sessionId in this.sessions)
                    this.sessions[sessionId].error('todo');
            } else {
                for (let i=1; i<hashes.length; i++)
                    for (let session of hashes[i][1])
                        session.error('todo');
            }
        }
        for (let session of hashes[0][1])
            session.onStep(this.sectorId, stepId, step.userActions);
        this.stepId++;
        return true;
    }
    // for server-side sector to sector events
    addAction(action){
        let step = this._getStep(this.stepId+1);
        step.userActions.push(action);
    }
}

class BCServer extends EventEmitter {
    constructor(sectors){
        super();
        this.sectors = sectors||{};
        this.sectors2 = sectors||{};
        this.nextSessionId = 1;
        this.sessions = {};
    }
    createSession(connection){
        let id = this.nextSessionId++;
        return this.sessions[id] = new BCServerSession(id, connection, this);
    }
    getSector(sectorId){
        return this.sectors[sectorId];
    }
    subscribe(sectorIds, onSubscribed, session){
        for (let sectorId of sectorIds){
            let sector = this.getSector(sectorId);
            if (onSubscribed){
                if (sector.stepId>sector.objectsStepId){
                    // todo save callbacks per sectorId
                    sector.awaitingCallbacks.push(onSubscribed);
                    Object.values(sector.sessions)[0].getSector(sectorId);
                } else
                    onSubscribed(sectorId, sector.stepId, sector.objects);
            }
            sector.sessions[session.id] = session;
        }
    }
    sectorSubscribe(sectorId, session){
        return this.getSector(sectorId).connect(session);
    }
    /**
     * @deprecated
     */
    unsubscribe(sectorIds, session, onUnsubscribe){
        for (let sectorId of sectorIds){
            let sector = this.sectors[sectorId];
            // todo: no sector case
            if (sector)
                delete sector.sessions[session.id];
            onUnsubscribe && onUnsubscribe(sectorId);
        }
    }
    sectorUnsubscribe(sectorId, sessionId){
        this.sectors[sectorId].disconnect(sessionId);
    }
    // TODO: session is circular dependency
    step(sectorId, stepId, hash, userActions, session){
        let sector = this.sectors[sectorId];
        sector.stepId = Math.max(sector.stepId, stepId);
        // todo: confirm all client sent the same migrates
        if (sector.step(session, stepId, hash, userActions))
            for (let userAction of userActions)
                if (userAction.key==='migrate')
                    this.getSector(userAction.sector).addAction(userAction);
    }
    userAction(sectorId, userAction){
        // todo: confirm all client sent the same migrates
        sectorId = userAction.key==='migrate' ? userAction.sector : sectorId;
        this.getSector(sectorId).addAction(userAction);
    }
    step2(){
        for (let sectorId in this.sectors2)
            this.sectors2[sectorId].step();
    }
    confirmStep(sectorId, session, stepId, hash){
        let sector = this.sectors2[sectorId];
        return sector.confirmStep(session, stepId, hash);
    }
    setSector(sectorId, objectsStepId, objects){
        let sector = this.sectors[sectorId];
        sector.objectsStepId = objectsStepId;
        sector.objects = objects;
        let onSubscribed;
        while ((onSubscribed = sector.awaitingCallbacks.pop()))
            onSubscribed(sectorId, objectsStepId, sector.objects);
    }
}

module.exports = {BCServer, BCServerSector, BCServerSector2, WsConnection, BCClientSession};
