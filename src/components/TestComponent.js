import React from 'react';
import ReactDOM from 'react-dom';
import { MDBBtn, MDBMask, MDBAnimation  } from 'mdbreact';

export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      isGameShown: false
    };
  }
  showChat = ()=>{
    this.setState({ isGameShown: !this.state.isGameShown });
  };
  render() {
    const { isGameShown } = this.state;
    return (
      <div className="bg-img">
        <div className="color-mask">
          <MDBMask className="mask pt-3 pl-5 pr-5" pattern={5} overlay="red-strong">
            <h1 className="title display-4">Battle City 2</h1>
            <div className="btns-block">
              <MDBBtn
                outline
                color="blue-grey lighten-5"
                onClick={this.showChat}>
                create new game
              </MDBBtn>
              <MDBBtn outline color="blue-grey lighten-5">donate</MDBBtn>
            </div>
            <div className="container-blocks">
              {isGameShown &&
                <MDBAnimation type="flipInY" className="chat-block">

                </MDBAnimation >
              }
              {isGameShown &&
                <MDBAnimation type="flipInY" className="game-desk-block">

                </MDBAnimation >
              }
              {isGameShown &&
                <MDBAnimation type="flipInY" className="right-menu-block">

                </MDBAnimation >
              }
            </div>
          </MDBMask>
        </div>
      </div>
    );
  }
}
