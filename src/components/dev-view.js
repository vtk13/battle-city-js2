import React from 'react';
const {BCServer, BCServerSector} = require('../core/server');
const {BCClient} = require('../core/client');
import img from '../img/tank1-up-s1.png';

let server = new BCServer({
    1: new BCServerSector(1, 0, [{id: 'tank', x: 0, y: 0}]),
});

export default class DevView extends React.Component {
    constructor(props){
        super(props);
        this.img = new Image();
        this.img.src = img;
        this.state = {clients: [0, 1]};
        this.clients = this.state.clients.map(id=>this.createClient(id));
    }
    draw(canvas, objects){
        let c2d = document.getElementById(canvas).getContext('2d');
        c2d.fillStyle = '#aaa';
        c2d.fillRect(0, 0, 300, 300);
        for (let object of objects){
            c2d.drawImage(this.img, 150+object.x, 150-object.y);
        }
    }
    completeStep(){
        this.clients.map(client=>client.completeStep());
    }
    action(){
        this.clients[0].action(1, {key: 'w'});
    }
    createClient(id){
        let client = new BCClient(server.createSession());
        client.subscribe([1]);
        client.on('step', ()=>this.draw('client'+id, client.sectors[1].objects));
        return client;
    }
    add(){
        this.setState(state=>{
            this.clients.push(this.createClient(state.clients.length));
            state.clients.push(state.clients.length);
            return state;
        });
    }
    render(){
        return [
            <div key="1" className="row">
                <div className="col-sm-12">
                    {this.state.clients.map(id=>
                        <canvas key={id} id={'client'+id} width="300" height="300"/>)}
                        <div className="canvas" onClick={()=>this.add()}>+</div>
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
