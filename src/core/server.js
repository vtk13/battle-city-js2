const _ = require('lodash');
const EventEmitter = require('events');

function allEqual(obj){
    let arr = Object.values(obj);
    return arr.length && _.every(arr, v=>v==arr[0]);
}

class BCSession extends EventEmitter {
    constructor(id, server){
        super();
        this.id = id;
        this.server = server;
    }
    /**
     * @param sectorIds
     * @param onSubscribed function(sectorId, stepId, objects)
     * @todo common word, rename. 'sectorSubscribe'?
     */
    subscribe(sectorIds, onSubscribed){
        this.server.subscribe(sectorIds, (sectorId, stepId, objects)=>{
            objects = JSON.parse(JSON.stringify(objects));
            onSubscribed && onSubscribed(sectorId, stepId, objects);
        }, this);
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
        this.server.confirmStep(sectorId, this, stepId, hash);
    }
    setSector(sectorId, objectsStepId, objects){
        this.server.setSector(sectorId, objectsStepId, objects);
    }
    // asks client to get sector data
    // client is expected to call setSector once received the message
    getSector(sectorId){
        this.emit('getSector', sectorId);
    }
    // it is time to process another step
    onStep(sectorId, stepId, userActions){
        this.emit('step', sectorId, stepId, userActions);
    }
    error(msg){
        this.emit('error', msg);
    }
}

class BCServerSector2 {
    constructor(sectorId = '0:0', stepId = 0, objectsData = {}){
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
        this.sessions = [];
        this.maxStepDepth = 10;
        this.pendingSteps = {};
        this.userActions = [];
    }
    connect(session){
        this.sessions.push(session);
    }
    disconnect(sessionId, error){
        let session = _.find(this.sessions, {id: sessionId});
        if (error)
            session.error(error);
        for (let stepId in this.pendingSteps)
        {
            let step = this.pendingSteps[stepId];
            if (step.confirmed)
                continue;
            delete step.hashes[sessionId];
            this._processStep(step);
        }
    }
    step(){
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
        if (_.filter(this.pendingSteps, {confirmed: false}).length>this.maxStepDepth)
        {
            let step = _.find(this.pendingSteps, {confirmed: false});
            for (let sessionId in step.hashes)
                if (!step.hashes[sessionId])
                    this.disconnect(+sessionId, 'timeout');
        }
    }
    confirmStep(session, stepId, hash){
        if (!(stepId in this.pendingSteps))
            throw new Error('Invalid stepId');
        let step = this.pendingSteps[stepId];
        if (!(session.id in step.hashes))
            throw new Error('Unexpected session');
        step.hashes[session.id] = hash;
        this._processStep(step);
    }
    addAction(action){
        this.userActions.push(action);
    }
    _processStep(step){
        if (!_.every(step.hashes, Boolean))
            return;
        if (_.keys(step.hashes).length<2)
            return void this._callChipAndDale();
        if (allEqual(step.hashes))
            step.confirmed = true;
        else
            throw new Error('TODO');
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
    createSession(){
        let id = this.nextSessionId++;
        return this.sessions[id] = new BCSession(id, this);
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
        sector.confirmStep(session, stepId, hash);
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

module.exports = {BCServer, BCServerSector, BCServerSector2};
