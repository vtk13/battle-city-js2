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
    constructor(session, factory){
        super();
        this.camX = 0;
        this.camY = 0;
        this.sectorWidth = 300;
        this.sectorEdge = 50;
        this.sectors = {};
        this.session = session;
        this.factory = factory;
        session.on('step', this.onStep.bind(this));
        session.on('getSector', sectorId=>{
            let {stepId, objects} = this.sectors[sectorId];
            session.setSector(sectorId, stepId, objects);
        });
    }
    _checkCoord(c, edge){
        let w = this.sectorWidth;
        if ((c%w+w)%w<edge)
            return -1;
        if (((c+edge)%w+w)%w<edge)
            return 1;
        return 0;
    }
    setCamXY(x, y){
        let currentSectors = Object.keys(this.sectors);
        this.camX = x;
        this.camY = y;
        let sx = Math.floor(x/this.sectorWidth), sy = Math.floor(y/this.sectorWidth);
        let all = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0],
            [-1, -1], [0, -1], [1, -1]];
        let subscribeMap = {
            '-1-1': [[-1, 0], [-1, -1], [0, -1]],
            '-10': [[-1, 0]],
            '-11': [[-1, 0], [-1, 1], [0, 1]],
            '0-1': [[0, -1]],
            '00': [],
            '01': [[0, 1]],
            '1-1': [[1, 0], [1, -1], [0, -1]],
            '10': [[1, 0]],
            '11': [[1, 0], [1, 1], [0, 1]],
        };
        let subKey = ''+this._checkCoord(x, this.sectorEdge)
            +this._checkCoord(y, this.sectorEdge);
        let toSubscribe = [sx+':'+sy].concat(subscribeMap[subKey].map(
            ([dx, dy])=>(sx+dx)+':'+(sy+dy)));
        let keepKey = ''+this._checkCoord(x, this.sectorWidth>>1)
            +this._checkCoord(y, this.sectorWidth>>1);
        let toKeep = _.uniq(toSubscribe.concat(
            subscribeMap[keepKey].map(([dx, dy])=>(sx+dx)+':'+(sy+dy))));
        this.subscribe(_.difference(toSubscribe, currentSectors));
        this.unsubscribe(_.difference(currentSectors, toKeep));
    }
    subscribe(sectorIds, onSubscribed){
        this.session.subscribe(sectorIds, (sectorId, stepId, objects)=>{
            objects = objects.map(object=>this.factory.makeObject(object));
            this.sectors[sectorId] = new BCClientSector(sectorId, stepId, objects, this.factory);
            onSubscribed && onSubscribed(sectorId);
        });
    }
    unsubscribe(sectorIds){
        this.session.unsubscribe(sectorIds, sectorId=>{
            delete this.sectors[sectorId];
        });
    }
    action(sectorId, action){
        this.sectors[sectorId].userActions.push(action);
    }
    completeStep(sectorId){
        let sector = this.sectors[sectorId], res = sector.completeStep();
        this.session.step(sector.sectorId, res.stepId, res.hash, res.userActions);
    }
    completeStepAll(){
        for (let sectorId in this.sectors)
            this.completeStep(sectorId);
    }
    onStep(sectorId, stepId, userActions){
        if (!this.sectors[sectorId])
            throw new Error('invalid sectorId');
        this.sectors[sectorId].onStep(stepId, userActions);
        this.emit('step', sectorId);
    }
}

class BCClientSector {
    constructor(sectorId, stepId, objects, factory){
        this.sectorId = sectorId;
        this.stepId = stepId;
        this.objects = objects;
        this.factory = factory;
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
        this.stepId++;
        for (let action of userActions){
            let {sessionId} = action;
            let target = _.find(this.objects, {sessionId});
            switch (action.key){
            case 'w':
            case 'a':
            case 's':
            case 'd':
                if (target)
                    target.moving = action.key;
                else
                    console.warn('no target');
                break;
            case 'stop':
                if (target)
                    target.moving = null;
                else
                    console.warn('no target');
                break;
            case 't':
                this.objects.push(this.factory.makeObject({className: 'tank',
                    x: action.x, y: action.y, sessionId}));
                break;
            default:
                console.log('invalid action', action);
            }
        }
        for (let object of this.objects)
        {
            if (object.step)
                object.step();
        }
    }
}

class BCObjectFactory {
    constructor(){
        this.classes = {};
    }
    register(className, constructor){
        this.classes[className] = constructor;
    }
    makeObject(object){
        let constructor = this.classes[object.className];
        let res = Object.create(constructor.prototype);
        Object.assign(res, object);
        return res;
    }
}

module.exports = {BCClient, BCObjectFactory};
