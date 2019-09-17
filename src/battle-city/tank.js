
class Tank {
    // todo: constructor is not called so far
    constructor(id, sector, x, y){
        this.id = id;
        this.sector = sector;
        this.x = x;
        this.y = y;
        this.moving = null;
    }
    step(){
        switch (this.moving){
        case 'w':
            this.sector.moveObject(this, this.x, this.y+10);
            break;
        case 'a':
            this.sector.moveObject(this, this.x-10, this.y);
            break;
        case 's':
            this.sector.moveObject(this, this.x, this.y-10);
            break;
        case 'd':
            this.sector.moveObject(this, this.x+10, this.y);
            break;
        }
    }
}

module.exports = {Tank};
