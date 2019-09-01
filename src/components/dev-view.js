import React from 'react';
const {BCServer, BCServerSector} = require('../core/server');
const {BCClient} = require('../core/client');
import img from '../img/tank1-up-s1.png';

let server = new BCServer({
    1: new BCServerSector(1, 0, [{id: 'tank', x: 0, y: 0}]),
});

class GameView extends React.Component {
    componentDidMount(){
        this.client = new BCClient(server.createSession());
        this.client.subscribe([1], ()=>this.draw());
        this.client.on('step', ()=>this.draw());
    }
    draw(){
        let c2d = document.getElementById('client'+this.props.id).getContext('2d');
        c2d.fillStyle = '#aaa';
        c2d.fillRect(0, 0, 300, 300);
        for (let object of this.client.sectors[1].objects)
            c2d.drawImage(this.props.img, 150+object.x, 150-object.y);
    }
    action(){
        this.client.action(1, {key: 'w'});
    }
    render(){
        let {id} = this.props;
        return <div className="canvas-wrap">
            <canvas id={'client'+id} width="300" height="300"/>
            <form>
                <button type="button" onClick={()=>this.client.completeStep()}>step</button>
                <button type="button" onClick={()=>this.action()}>w</button>
            </form>
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
    render(){
        return <div className="row">
            <div className="col-sm-12">
                {this.state.clients.map(id=><GameView key={id} id={id} img={this.img}/>)}
                <div className="canvas-wrap">
                    <div className="canvas" onClick={()=>this.add()}>+</div>
                </div>
            </div>
        </div>;
    }
}
