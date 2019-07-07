const EventEmitter = require('events');

class BCSession extends EventEmitter {
    constructor(id, server){
        super();
        this.id = id;
        this.server = server;
    }
    subscribe(sectorIds){
        this.server.subscribe(sectorIds, this);
    }
    unsubscribe(sectorIds){
        this.server.unsubscribe(sectorIds, this);
    }
    step(stepId, sectorId, hash, userActions){
        this.server.step(stepId, sectorId, hash, userActions, this);
    }
    setSector(sectorId, dataStepId, data){
        this.server.setSector(sectorId, dataStepId, data);
    }
}

class BCSector {
    constructor(stepId, data){
        this.stepId = stepId;
        this.dataStepId = stepId;
        this.data = data;
        this.sessions = {};
        this.awaitingPlayers = [];
        this.lastSteps = {};
    }
    addHash(session, stepId, hash){
        let ls = this.lastSteps[stepId] = this.lastSteps[stepId] || {n: 0, hashes: {}};
        ls.hashes[hash] = ls.hashes[hash] || [];
        ls.hashes[hash].push(session);
        ls.n++;
        // TODO: optimize Object.keys
        if (ls.n < Object.keys(this.sessions).length)
            return;
        let hashes = Object.entries(ls.hashes).sort((a, b)=>b[1].length-a[1].length);
        if (hashes.length<=1)
            return;
        if (hashes[0][1].length==hashes[1][1].length){
            for (let sessionId in this.sessions)
                this.sessions[sessionId].emit('error');
        } else {
            for (let i=1; i<hashes.length; i++)
                for (let session of hashes[i][1])
                    session.emit('error');
        }
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
    subscribe(sectorIds, session){
        for (let sectorId of sectorIds){
            let sector = this.sectors[sectorId];
            if (sector.stepId>sector.dataStepId){
                Object.values(sector.sessions)[0].emit('getSector', sectorId);
                sector.awaitingPlayers.push(session);
            } else
                session.emit('subscribe', sectorId, sector.data);
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
    step(stepId, sectorId, hash, userActions, session){
        let sector = this.sectors[sectorId];
        sector.stepId = Math.max(sector.stepId, stepId);
        sector.addHash(session, stepId, hash);
        for (let sessionId in sector.sessions){
            let session = sector.sessions[sessionId];
            session.emit('step', stepId, sectorId, userActions);
        }
    }
    setSector(sectorId, dataStepId, data){
        let sector = this.sectors[sectorId];
        sector.dataStepId = dataStepId;
        sector.data = data;
        let session;
        while ((session = sector.awaitingPlayers.pop()))
            session.emit('subscribe', sectorId, sector.data);
    }
}

module.exports = {BCServer, BCSector};
