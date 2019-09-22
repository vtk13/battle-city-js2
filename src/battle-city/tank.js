
class Tank {
    constructor() {
        this.id = 0;
        this.sector = '';
        this.x = 0;
        this.y = 0;
        this.moving = null;
    }
    // returns true if object should be removed from sector
    step(){
        let remove;
        switch (this.moving){
        case 'w':
            remove = this.sector.moveObject(this, this.x, this.y+10);
            break;
        case 'a':
            remove = this.sector.moveObject(this, this.x-10, this.y);
            break;
        case 's':
            remove = this.sector.moveObject(this, this.x, this.y-10);
            break;
        case 'd':
            remove = this.sector.moveObject(this, this.x+10, this.y);
            break;
        }
        return remove;
    }
}

module.exports = {Tank};
