
class Tank {
    // todo: constructor is not called so far
    constructor(id, x, y){
        this.id = id;
        this.x = x;
        this.y = y;
        this.moving = null;
    }
    step(){
        switch (this.moving){
        case 'w':
            this.y -= 10;
            break;
        case 'a':
            this.x -= 10;
            break;
        case 's':
            this.y += 10;
            break;
        case 'd':
            this.x += 10;
            break;
        }
    }
}

module.exports = {Tank};
