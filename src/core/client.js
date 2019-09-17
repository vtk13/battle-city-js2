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
            let stepId = this.sectors[sectorId].stepId;
            let objects = this.sectors[sectorId].exportObjects();
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
            this.sectors[sectorId] = new BCClientSector(
                sectorId, this.sectorWidth, stepId, this, this.factory);
            this.sectors[sectorId].importObjects(objects);
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
    /**
     * @param sectorIds string|Array|undefined
     */
    completeStep(sectorIds){
        if (!sectorIds)
            sectorIds = Object.keys(this.sectors);
        if (!Array.isArray(sectorIds))
            sectorIds = [sectorIds];
        let finalized = _.map(_.pick(this.sectors, sectorIds),
            sector=>({sector, res: sector.completeStep()}));
        finalized.map(({sector, res})=>
            this.session.step(sector.sectorId, res.stepId, res.hash, res.userActions));
    }
    onStep(sectorId, stepId, userActions){
        if (!this.sectors[sectorId])
            throw new Error('invalid sectorId');
        this.sectors[sectorId].onStep(stepId, userActions);
        this.emit('step', sectorId);
    }
}

class BCClientSector {
    constructor(sectorId, sectorWidth, stepId, client, factory){
        // x*BCClient.sectorWidth+':'+y*BCClient.sectorWidth
        this.sectorId = sectorId;
        this.sectorWidth = sectorWidth;
        this.stepId = stepId;
        this.objects = [];
        this.client = client;
        this.factory = factory;
        this.userActions = [];
    }
    importObjects(objects){
        this.objects = objects.map(object=>this.factory.makeObject(this, object));
    }
    exportObjects(){
        return this.objects.map(object=>this.exportObject(object));
    }
    exportObject(object){
        return _.omit(object, 'sector');
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
                this.objects.push(this.factory.makeObject(this,
                    {className: 'tank', x: action.x, y: action.y, sessionId}));
                break;
            case 'migrate':
                this.objects.push(this.factory.makeObject(this, action.object));
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
    moveObject(object, x, y){
        // todo use relative coordinates in sector?
        let [sx, sy] = this.sectorId.split(':');
        sx = +sx;
        sy = +sy;
        object.x = x;
        object.y = y;
        if (sx*this.sectorWidth<=x && x<(sx+1)*this.sectorWidth &&
            sy*this.sectorWidth<=y && y<(sy+1)*this.sectorWidth)
            return;
        if (x<sx*this.sectorWidth)
            sx--;
        else if ((sx+1)*this.sectorWidth<=x)
            sx++;
        if (y<sy*this.sectorWidth)
            sy--;
        else if ((sy+1)*this.sectorWidth<=y)
            sy++;
        // todo emit action on current sector, server will emit it on target
        //   sector once all subscribers confirm event
        this.client.action(sx+':'+sy, {key: 'migrate', sx, sy,
            object: this.exportObject(object)});
        this.objects = this.objects.filter(o=>o!=object);
    }
}

class BCObjectFactory {
    constructor(){
        this.classes = {};
    }
    register(className, constructor){
        this.classes[className] = constructor;
    }
    makeObject(sector, object){
        let constructor = this.classes[object.className];
        let res = Object.create(constructor.prototype);
        Object.assign(res, object);
        res.sector = sector;
        return res;
    }
}

module.exports = {BCClient, BCObjectFactory};
