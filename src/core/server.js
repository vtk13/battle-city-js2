const EventEmitter = require('events');

/**
 * emits:
 * - getSector(sectorId) - server wants to get actual objects for the sector
 *   and you should send it back by calling setSector
 * - subscribe(sectorId, objects) - just subscribed for a sector
 * - step(sectorId, stepId, userActions) - another step is ready to be processed
 * - error
 */
class BCSession extends EventEmitter {
    constructor(id, server){
        super();
        this.id = id;
        this.server = server;
    }
    /**
     * TODO: add objectsStepId to onSubscribed callback
     *
     * @param sectorIds
     * @param onSubscribed function(sectorId, stepId, objects)
     */
    subscribe(sectorIds, onSubscribed){
        this.server.subscribe(sectorIds, (sectorId, stepId, objects)=>{
            objects = JSON.parse(JSON.stringify(objects));
            onSubscribed && onSubscribed(sectorId, stepId, objects);
        }, this);
    }
    unsubscribe(sectorIds){
        this.server.unsubscribe(sectorIds, this);
    }
    step(sectorId, stepId, hash, userActions){
        this.server.step(sectorId, stepId, hash, userActions, this);
    }
    setSector(sectorId, objectsStepId, objects){
        this.server.setSector(sectorId, objectsStepId, objects);
    }
}

class BCServerSector {
    constructor(sectorId, stepId, objects){
        this.sectorId = sectorId;
        this.stepId = stepId;
        // stepId of objects snapshot, objects is not synced every step
        this.objectsStepId = stepId;
        this.objects = objects;
        this.sessions = {};
        this.awaitingCallbacks = [];
        this.lastSteps = {};
    }
    // todo test new connection then step for previous connection
    //      ls.n will never be equal to sessions.length
    step(session, stepId, hash, userActions){
        let ls = this.lastSteps[stepId] = this.lastSteps[stepId] || {n: 0, hashes: {}, userActions: []};
        ls.hashes[hash] = ls.hashes[hash] || [];
        ls.hashes[hash].push(session);
        ls.userActions.push(...userActions);
        ls.n++;
        // TODO: optimize Object.keys
        if (ls.n < Object.keys(this.sessions).length)
            return;
        let hashes = Object.entries(ls.hashes).sort((a, b)=>b[1].length-a[1].length);
        if (hashes.length>1){
            if (hashes[0][1].length===hashes[1][1].length){
                for (let sessionId in this.sessions)
                    this.sessions[sessionId].emit('error');
            } else {
                for (let i=1; i<hashes.length; i++)
                    for (let session of hashes[i][1])
                        session.emit('error');
            }
        }
        for (let session of hashes[0][1])
            session.emit('step', this.sectorId, stepId, ls.userActions);
    }
}

class BCServer extends EventEmitter {
    constructor(sectors){
        super();
        this.sectors = sectors;
        this.nextSessionId = 1;
        this.sessions = {};
    }
    createSession(){
        let id = this.nextSessionId++;
        return this.sessions[id] = new BCSession(id, this);
    }
    subscribe(sectorIds, onSubscribed, session){
        for (let sectorId of sectorIds){
            let sector = this.sectors[sectorId];
            if (onSubscribed){
                if (sector.stepId>sector.objectsStepId){
                    Object.values(sector.sessions)[0].emit('getSector', sectorId);
                    // todo save callbacks per sectorId
                    sector.awaitingCallbacks.push(onSubscribed);
                } else
                    onSubscribed(sectorId, sector.stepId, sector.objects);
            }
            sector.sessions[session.id] = session;
        }
    }
    unsubscribe(sectorIds, session){
        for (let sectorId of sectorIds){
            let sector = this.sectors[sectorId];
            delete sector.sessions[session.id];
        }
    }
    // TODO: session is circular dependency
    step(sectorId, stepId, hash, userActions, session){
        let sector = this.sectors[sectorId];
        sector.stepId = Math.max(sector.stepId, stepId);
        sector.step(session, stepId, hash, userActions);
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

module.exports = {BCServer, BCServerSector};
