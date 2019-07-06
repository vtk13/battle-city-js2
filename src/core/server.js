const EventEmitter = require('events');

class BCServer extends EventEmitter {
    subscribe(sectors){
        for (let sectorId of sectors)
            this.emit('subscribe', sectorId, [{}, {}]);
    }
}

module.exports = BCServer;
