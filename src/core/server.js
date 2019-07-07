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
        for (let sectorId of sectorIds)
            session.emit('subscribe', sectorId, this.sectors[sectorId]);
    }
    step(stepId, sectorId, hash, userActions){
        for (let sessionId in this.sessions){
            let session = this.sessions[sessionId];
            session.emit('step', stepId, sectorId, userActions);
        }
    }
}

module.exports = BCServer;
