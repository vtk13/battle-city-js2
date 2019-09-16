import React from 'react';
const {BCServer, BCServerSector} = require('../core/server');
const {BCClient, BCObjectFactory} = require('../core/client');
const {Tank} = require('../battle-city/tank');
import img from '../img/tank1-up-s1.png';

let factory = new BCObjectFactory();
factory.register('tank', Tank);

class BCDevServer extends BCServer {
    subscribe(sectorIds, onSubscribed, session) {
        for (let sectorId of sectorIds)
            if (!this.sectors[sectorId])
                this.sectors[sectorId]= new BCServerSector(sectorId, 0, []);
        super.subscribe(sectorIds, onSubscribed, session);
    }
}

let server = new BCDevServer();

let currentSectorId = '0:0';

class GameView extends React.Component {
    constructor(props){
        super(props);
        this.state = {camX: 0, camY: 0};
    }
    componentDidMount(){
        this.client = new BCClient(server.createSession(), factory);
        this.camOffset(0, 0);
        this.client.on('step', sectorId=>{
            console.trace();
            this.draw();
            if (this.props.autoStep)
                setTimeout(()=>this.client.completeStep(sectorId), 1000);
        });
    }
    draw(){
        let canvas = document.getElementById('client'+this.props.id);
        let c2d = canvas.getContext('2d');
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.clearRect(0, 0, canvas.width, canvas.height);
        c2d.lineWidth = 0.5;
        c2d.strokeStyle = '#555';
        let scale = 0.4;
        c2d.setTransform(scale, 0, 0, scale,
            -this.state.camX*scale+150, -this.state.camY*scale+150);
        for (let sectorId in this.client.sectors){
            let sector = this.client.sectors[sectorId];
            let [sx, sy] = sector.sectorId.split(':').map(Number);
            sector._bg = sector._bg||('#aa'+(4+Math.random()*8>>0).toString(16));
            c2d.fillStyle = sector._bg;
            let w = this.client.sectorWidth;
            c2d.fillRect(sx*w, sy*w, w, w);
        }
        for (let i=-5; i<5; i++)
            for (let j=-5; j<5; j++){
                c2d.beginPath();
                c2d.moveTo(i*100-4, j*100+0.5);
                c2d.lineTo(i*100+3, j*100+0.5);
                c2d.stroke();
                c2d.beginPath();
                c2d.moveTo(i*100-0.5, j*100-3);
                c2d.lineTo(i*100-0.5, j*100+4);
                c2d.stroke();
            }
        for (let sectorId in this.client.sectors)
            for (let object of this.client.sectors[sectorId].objects) {
                c2d.drawImage(this.props.img, object.x, object.y);
            }
    }
    newTank(){
        this.client.action(currentSectorId, {key: 't',
            x: (Math.random()*200>>0)-100,
            y: (Math.random()*200>>0)-100});
    }
    camOffset(x, y){
        this.setState(
            state=>({...state, camX: state.camX+x, camY: state.camY+y}),
            ()=>{
                this.client.setCamXY(this.state.camX, this.state.camY);
                this.draw();
            });
    }
    render(){
        let {id} = this.props;
        return <div className="canvas-wrap">
            <canvas id={'client'+id} width="300" height="300"/>
            <table className="controls">
                <tbody>
                <tr>
                    <td className="wide"><button type="button" onClick={()=>this.client.completeStepAll()}>step</button></td>
                    <td></td>
                    <td><button type="button" onClick={()=>this.client.action(currentSectorId, {key: 'w'})}>🡅</button></td>
                    <td></td>
                    <td>cam</td>
                    <td><button type="button" onClick={()=>this.camOffset(0, -10)}>🡅</button></td>
                    <td></td>
                </tr>
                <tr>
                    <td className="wide"><button type="button" onClick={()=>this.newTank()}>t</button></td>
                    <td><button type="button" onClick={()=>this.client.action(currentSectorId, {key: 'a'})}>🡄</button></td>
                    <td><button type="button" onClick={()=>this.client.action(currentSectorId, {key: 'stop'})}>■</button></td>
                    <td><button type="button" onClick={()=>this.client.action(currentSectorId, {key: 'd'})}>🡆</button></td>
                    <td><button type="button" onClick={()=>this.camOffset(-10, 0)}>🡄</button></td>
                    <td><button type="button" onClick={()=>this.setState({camX: 0, camY: 0}, ()=>this.draw())}>0</button></td>
                    <td><button type="button" onClick={()=>this.camOffset(10, 0)}>🡆</button></td>
                </tr>
                <tr>
                    <td className="wide"></td>
                    <td></td>
                    <td><button type="button" onClick={()=>this.client.action(currentSectorId, {key: 's'})}>🡇</button></td>
                    <td></td>
                    <td></td>
                    <td><button type="button" onClick={()=>this.camOffset(0, 10)}>🡇</button></td>
                    <td></td>
                </tr>
                </tbody>
            </table>
        </div>;
    }
}

export default class DevView extends React.Component {
    constructor(props){
        super(props);
        this.img = new Image();
        this.img.src = img;
        this.img.addEventListener('load', ()=>{
            this.add();
            this.add();
        });
        this.state = {clients: []};
    }
    add(){
        this.setState(state=>({...state, clients: [...state.clients, state.clients.length]}));
    }
    setAutoStep(e){
        this.setState({autoStep: e.target.checked});
    }
    render(){
        return <div className="row">
            <div className="col-sm-12">
                {this.state.clients.map(id=>
                    <GameView key={id} id={id} img={this.img} autoStep={this.state.autoStep}/>)}
                <div className="canvas-wrap">
                    <div className="canvas" onClick={()=>this.add()}>+</div>
                    <div>
                        <label>
                            <input type="checkbox" onChange={e=>this.setAutoStep(e)}/> auto step
                        </label>
                    </div>
                </div>
            </div>
        </div>;
    }
}
