const EventEmitter = require('events');

class BCSession extends EventEmitter {
    constructor(server){
        super();
        this.server = server;
    }
    subscribe(sectorIds){
        this.server.subscribe(sectorIds, this);
    }
    step(stepId, sectorId, hash, userActions){
        this.server.step(stepId, sectorId, hash, userActions);
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
        return this.sessions[this.nextSessionId++] = new BCSession(this);
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
    step(stepId, sectorId, hash, userActions){
        for (let sessionId in this.sessions){
            let sector = this.sectors[sectorId];
            sector.stepId = Math.max(sector.stepId, stepId);
            let session = this.sessions[sessionId];
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
