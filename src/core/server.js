const EventEmitter = require('events');

class BCServer extends EventEmitter {
    constructor(sectors){
        super();
        this.sectors = sectors;
    }
    subscribe(sectors){
        for (let sectorId of sectors)
            this.emit('subscribe', sectorId, this.sectors[sectorId]);
    }
}

module.exports = BCServer;
