const _ = require('lodash');
const EventEmitter = require('events');

function objectId(object){
    if (!object)
        return;
    if (object.hasOwnProperty('object_id'))
        return object.object_id;
    return object.object_id = objectId.n++;
}
objectId.n = 1;

class BCClient extends EventEmitter {
    constructor(session){
        super();
        this.session = session;
        session.on('step', this.onStep.bind(this));
        this.sectors = {};
    }
    subscribe(sectorIds){
        this.session.subscribe(sectorIds, (sectorId, stepId, object)=>{
            this.sectors[sectorId] = new BCClientSector(sectorId, stepId, object);
        });
    }
    action(sectorId, action){
        this.sectors[sectorId].userActions.push(action);
    }
    completeStep(){
        for (let sectorId in this.sectors){
            let sector = this.sectors[sectorId], res = sector.completeStep();
            this.session.step(sector.sectorId, res.stepId, res.hash, res.userActions);
        }
    }
    onStep(sectorId, stepId, userActions){
        if (!this.sectors[sectorId])
            throw new Error('invalid sectorId');
        this.sectors[sectorId].onStep(stepId, userActions);
        this.emit('step');
    }
}

class BCClientSector {
    constructor(sectorId, stepId, objects){
        this.sectorId = sectorId;
        this.stepId = stepId;
        this.objects = objects;
        this.userActions = [];
    }
    completeStep(){
        let userActions = this.userActions;
        this.userActions = [];
        return {stepId: this.stepId, hash: 'A', userActions}
    }
    onStep(stepId, userActions){
        if (this.stepId!==stepId)
            throw new Error('mismatch stepId');
        // game logic stub
        if (_.get(userActions, [0, 'key'])==='w')
            this.objects[0].y += 10;
    }
}

module.exports = {BCClient};
