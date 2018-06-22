if (typeof Paho == undefined) {
  throw new Error("playerclient.js: Paho client not loaded and available in this scope");
}
console.log("Paho:", Paho);

import EventedMixin from './eventedmixin.js';
class Noop {};
class PlayerClient extends EventedMixin(Noop) {
  constructor(options={}) {
    super();
    this.pairId = null;
    this.connectOptions = Object.assign({
      cleanSession: true,
      onSuccess: resp => {
        console.log("success connecting");
        this.onConnect();
      },
      onFailure: resp => {
        console.warn(`failed to connect: ${resp.errorCode} - ${resp.errorMessage}`);
      },
    }, options.connectOptions);
    this.options = Object.assign({}, options);
    this.topicPrefix = "gigascapes";
    delete this.options.connectOptions;
    this._messageQueue = [];
    this._messageTimer;
    this.messageThrottleMs = 1000/10;
  }
  init() {
    console.log("init: connecting to mqtt broker at: ", this.connectOptions);
    // const connectOptions = {
    //   clientId: this.options.CLIENT_ID,
    //   username: this.options.USERNAME,
    //   password: this.options.PASSWORD,
    //   reconnectPeriod: 10*1000
    // };

    // create the mqtt client using the url + options (auth details, etc.)
    // TODO: if we fail to connect due to an auth error, currently this will
    // keep trying again and again which is a bit daft.


    // Parameters
    // let hostname = this.options.mqttHostname || "127.0.0.1"; // better if its a full uri
    // let clientId = this.options.mqttClientId || "ws" + Math.random();
    // let port = this.options.mqttPort || 1884;
    let path = '';

    // Create a client instance
    // docs: http://www.eclipse.org/paho/files/jsdoc/Paho.MQTT.Client.html
    var mqttClient = new Paho.MQTT.Client(
      this.connectOptions.hostname,
      Number(this.connectOptions.port),
      this.connectOptions.clientId
    );
    this.mqttClient = mqttClient;
    // this.mqttClient = mqtt.connect(this.options.CLOUDMQTT_URL, connectOptions);
    // let mqttClient = this.mqttClient

    // set callback handlers
    mqttClient.onConnectionLost = this.onDisconnect.bind(this);

    // connect the client
    mqttClient.connect(this.connectOptions);

    mqttClient.onMessageArrived = (message) => {
      this.options.VERBOSE && console.log("got message: ",
                                          message.destinationName,
                                          message.payloadString);
      let topic = message.destinationName;
      let [prefix, clientId] = topic.split('/');
      if (clientId !== this.clientId && topic.endsWith("positions")) {
        this.emit("received", {
          topic: message.destinationName,
          data: message.payloadString,
          clientId
        });
      }
    };
  }

  get connected() {
    return this.mqttClient && this.mqttClient.isConnected();
  }

  get clientId() {
    return this.connectOptions.clientId;
  }

  onConnect() {
    let mqttClient = this.mqttClient;
    mqttClient.subscribe(`${this.topicPrefix}/+/positions`);

    this.sendMessage(`${this.topicPrefix}/join`, `${this.clientId} is alive`);

    if(this._messageTimer) {
      clearInterval(this._messageTimer);
    }
    this._messageTimer = setInterval(() => {
      this.onTick();
    }, this.messageThrottleMs);

    this.emit("connected", { clientId: this.clientId });
  }

  onDisconnect(reason) {
    console.log('player mqtt client disconnected', reason);
    this.pairId = null;
    this.mqttClient = null;
    clearInterval(this._messageTimer);
    this._messageTimer = null;
    this.emit("disconnected", { clientId: this.clientId });
  }

  onTick() {
    if (this._messageQueue.length) {
      let [topic, payload] = this._messageQueue.pop();
      this.sendMessage(topic, payload);
      this._messageQueue.length = 0;
    }
  }

  enqueueMessage(topic, messageData) {
    this._messageQueue.push([topic, messageData]);
  }

  sendMessage(topic, messageData) {
    if (typeof topic == "object") {
      topic = `${topic.prefix}/${this.clientId}/${topic.name}`;
    }
    let payload = typeof messageData == "string" ? messageData : JSON.stringify(messageData);
    let message = new Paho.MQTT.Message(payload);
    message.destinationName = topic;
    let sendError;
    try {
      this.mqttClient.send(message);
    } catch (e) {
      sendError = e;
      console.warn("failed to send: ", e);
    }
    if (!sendError) {
      this.emit("sent", { topic, data: payload });
    }
  }

  broadcastPositions(data) {
    let topic = `${this.topicPrefix}/${this.clientId}/positions`;
    this.enqueueMessage(topic, data);
  }
};

export {PlayerClient as default};
