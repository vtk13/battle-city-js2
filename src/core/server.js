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
     * @param sectorId
     * @return object {sectorId, stepId, objectsStepId, objectsData, userActions}
     */
    sectorSubscribe(sectorId){
        return this.connection.call('sectorSubscribe', [sectorId]);
    }
    sectorUnsubscribe(sectorId){
        return this.connection.call('sectorUnsubscribe', [sectorId]);
    }
    userAction(sectorId, userAction){
        return this.connection.call('userAction', [sectorId, userAction]);
    }
    confirmStep(sectorId, stepId, hash){
        return this.connection.call('confirmStep', [sectorId, stepId, hash]);
    }
    /**
     * @param sectorId
     * @param stepId
     * @return {stepId, objectsData}
     */
    getSector(sectorId, stepId){
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
     * @param sectorId
     * @return object {sectorId, stepId, objectsStepId, objectsData, userActions}
     */
    sectorSubscribe(sectorId){
        return this.server.sectorSubscribe(sectorId, this);
    }
    sectorUnsubscribe(sectorId){
        this.server.sectorUnsubscribe(sectorId, this.id);
    }
    userAction(sectorId, userAction){
        userAction.sessionId = this.id;
        this.server.userAction(sectorId, userAction);
    }
    confirmStep(sectorId, stepId, hash){
        return this.server.confirmStep(sectorId, this, stepId, hash);
    }
    // asks client to get sector data for certain stepId
    getSector(sectorId, stepId){
        return this.connection.call('getSector', [sectorId, stepId]);
    }
    // it is time to process another step
    onStep(sectorId, stepId, userActions){
        return this.connection.call('onStep', [sectorId, stepId, userActions]);
    }
    error(msg){
        return this.connection.call('error', [msg]);
    }
}

class BCServerSector {
    constructor(sectorId = '0:0', stepId = 0, objectsData = {}){
        this.sectorId = sectorId;
        // current unfinished step id
        // increased after step is done
        this.stepId = stepId;
        // stepId of objects snapshot (stepId+1)
        // objects are not synced every step
        this.objectsStepId = stepId - 1;
        // latest available version of objects
        // data for objectsStepId
        this.objectsData = objectsData;
        this.sessions = [];
        this.maxStepDepth = 10;
        this.syncInterval = 30;
        this.pendingSteps = {};
        this.userActions = [];
        this.minClients = 2;
    }
    async connect(session){
        this.sessions.push(session);
        let res = _.pick(this, ['sectorId', 'stepId', 'objectsStepId', 'objectsData']);
        res.userActions = [];
        for (let i = this.objectsStepId + 1; i<this.stepId; i++)
            res.userActions.push(this.pendingSteps[i].userActions);
        return res;
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
        if (this.sessions.length<this.minClients)
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
            await this._maybeSyncObjects();
    }
    addAction(action){
        this.userActions.push(action);
    }
    _processHashes(stepId){
        let step = this.pendingSteps[stepId];
        if (!_.every(step.hashes, Boolean))
            return;
        if (_.keys(step.hashes).length<this.minClients)
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
    async _maybeSyncObjects(){
        let confirmedSteps = 0, lastConfirmedStep = this.objectsStepId;
        for (let stepId in this.pendingSteps)
        {
            let {confirmed} = this.pendingSteps[stepId];
            if (!confirmed)
                break;
            confirmedSteps++;
            lastConfirmedStep = +stepId;
        }
        if (confirmedSteps<this.syncInterval)
            return;
        let res = await this.sessions[0].getSector(this.sectorId, lastConfirmedStep);
        this.objectsStepId = res.stepId;
        this.objectsData = res.objectsData;
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
    sectorSubscribe(sectorId, session){
        return this.getSector(sectorId).connect(session);
    }
    sectorUnsubscribe(sectorId, sessionId){
        this.sectors[sectorId].disconnect(sessionId);
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
}

module.exports = {BCServer, BCServerSector, WsConnection, BCClientSession};
