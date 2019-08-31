import React from 'react';
const {BCServer, BCServerSector} = require('../core/server');
const {BCClient} = require('../core/client');
import img from '../img/tank1-up-s1.png';

let server = new BCServer({
    1: new BCServerSector(1, 0, [{id: 'tank', x: 0, y: 0}]),
});
let client1 = new BCClient(server.createSession());
client1.subscribe([1]);
let client2 = new BCClient(server.createSession());
client2.subscribe([1]);

export default class DevView extends React.Component {
    constructor(props){
        super(props);
        this.img = new Image();
        this.img.src = img;
    }
    componentDidMount(){
        client1.on('step', ()=>this.draw('client1', client1.sectors[1].objects));
        client2.on('step', ()=>this.draw('client2', client2.sectors[1].objects));
    }
    draw(canvas, objects){
        let c2d = document.getElementById(canvas).getContext('2d');
        c2d.fillStyle = '#aaa';
        c2d.fillRect(0, 0, 400, 400);
        for (let object of objects){
            c2d.drawImage(this.img, 200+object.x, 200-object.y);
        }
    }
    completeStep(){
        client1.completeStep();
        client2.completeStep();
    }
    action(){
        client1.action(1, {key: 'w'});
    }
    render(){
        return [
            <div key="1" className="row">
              <div className="col-sm-12">
                <canvas id="client1" width="400" height="400"></canvas>
                <canvas id="client2" width="400" height="400"></canvas>
              </div>
            </div>,
            <div key="2" className="row">
              <div className="col-sm-12">
                <form>
                  <button type="button" onClick={()=>this.completeStep()}>step</button>
                  <button type="button" onClick={()=>this.action()}>w</button>
                </form>
              </div>
            </div>
        ];
    }
}
