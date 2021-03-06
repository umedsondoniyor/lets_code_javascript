// Copyright (c) 2017 Titanium I.T. LLC. All rights reserved. For license, see "README" or "LICENSE" file.
(function() {
	"use strict";

	const io = require("socket.io");
	const failFast = require("fail_fast.js");
	const util = require("util");
	const EventEmitter = require("events");
	const ClientPointerMessage = require("../shared/client_pointer_message.js");
	const ClientRemovePointerMessage = require("../shared/client_remove_pointer_message.js");
	const ClientDrawMessage = require("../shared/client_draw_message.js");
	const ClientClearScreenMessage = require("../shared/client_clear_screen_message.js");

	const SUPPORTED_MESSAGES = [
		ClientPointerMessage,
		ClientRemovePointerMessage,
		ClientDrawMessage,
		ClientClearScreenMessage
	];

	const RealTimeServer = module.exports = class RealTimeServer extends EventEmitter {

		constructor(httpServer) {
			super();

			failFast.unlessDefined(httpServer, "httpServer");
			this._nodeHttpServer = httpServer.getNodeServer();

			this._socketIoConnections = {};
			this._io = io;
		}

		static createNull() {
			const server = new RealTimeServer(new NullHttpServer());
			server._io = nullIo;
			return server;
		}

		start() {
			this._ioServer = this._io(this._nodeHttpServer);
			this._nodeHttpServer.on("close", failFastIfHttpServerClosed);

			trackSocketIoConnections(this, this._socketIoConnections, this._ioServer);
			listenForClientMessages(this, this._ioServer);
		}

		stop() {
			const close = util.promisify(this._ioServer.close.bind(this._ioServer));

			this._nodeHttpServer.removeListener("close", failFastIfHttpServerClosed);
			return close();
		}

		sendToOneClient(clientId, message) {
			const socket = lookUpSocket(this, clientId);
			socket.emit(message.name(), message.payload());
			recordServerMessage(this, {
				message,
				clientId,
				type: RealTimeServer.SEND_TYPE.ONE_CLIENT
			});
		}

		broadcastToAllClients(message) {
			this._ioServer.emit(message.name(), message.payload());
			recordServerMessage(this, {
				message,
				type: RealTimeServer.SEND_TYPE.ALL_CLIENTS
			});
		}

		broadcastToAllClientsButOne(clientToExclude, message) {
			const socket = lookUpSocket(this, clientToExclude);
			socket.broadcast.emit(message.name(), message.payload());
			recordServerMessage(this, {
				message,
				clientId: clientToExclude,
				type: RealTimeServer.SEND_TYPE.ALL_CLIENTS_BUT_ONE
			});
		}

		getLastSentMessage() {
			return this._lastSentMessage;
		}

		isClientConnected(clientId) {
			return this._socketIoConnections[clientId] !== undefined;
		}

		numberOfActiveConnections() {
			return Object.keys(this._socketIoConnections).length;
		}

		simulateClientMessage(clientId, message) {
			handleClientMessage(this, clientId, message);
		}

		connectNullClient(clientId) {
			connectClient(this, new NullSocket(clientId));
		}

		disconnectNullClient(clientId) {
			const socket = lookUpSocket(this, clientId);
			failFast.unlessTrue(socket.isNull === true, `Attempted to disconnect non-null client: [${clientId}]`);
			disconnectClient(this, socket);
		}
	};

	RealTimeServer.EVENT = {
		CLIENT_DISCONNECT: "clientDisconnect",
		CLIENT_CONNECT: "clientConnect",
		CLIENT_MESSAGE: "clientMessage",
		SERVER_MESSAGE: "serverMessage"
	};

	RealTimeServer.SEND_TYPE = {
		ONE_CLIENT: "one_client",
		ALL_CLIENTS: "all_clients",
		ALL_CLIENTS_BUT_ONE: "all_clients_but_one"
	};

	function recordServerMessage(self, messageInfo) {
		self._lastSentMessage = messageInfo;
		self.emit(RealTimeServer.EVENT.SERVER_MESSAGE, messageInfo);
	}

	function trackSocketIoConnections(self, connections, ioServer) {
		// Inspired by isaacs
		// https://github.com/isaacs/server-destroy/commit/71f1a988e1b05c395e879b18b850713d1774fa92
		ioServer.on("connection", function(socket) {
			connectClient(self, socket);
			socket.on("disconnect", function() {
				disconnectClient(self, socket);
			});
		});
	}

	function listenForClientMessages(self, ioServer) {
		ioServer.on("connect", (socket) => {
			SUPPORTED_MESSAGES.forEach(function(messageConstructor) {
				socket.on(messageConstructor.MESSAGE_NAME, function(payload) {
					handleClientMessage(self, socket.id, messageConstructor.fromPayload(payload));
				});
			});
		});
	}

	function handleClientMessage(self, clientId, message) {
		self.emit(RealTimeServer.EVENT.CLIENT_MESSAGE, { clientId, message });
	}

	function connectClient(self, socket) {
		const key = socket.id;
		failFast.unlessDefined(key, "socket.id");

		self._socketIoConnections[key] = socket;
		self.emit(RealTimeServer.EVENT.CLIENT_CONNECT, key);
	}

	function disconnectClient(self, socket) {
		const key = socket.id;
		failFast.unlessDefined(key, "socket.id");

		delete self._socketIoConnections[key];
		self.emit(RealTimeServer.EVENT.CLIENT_DISCONNECT, key);
	}

	function lookUpSocket(self, clientId) {
		const socket = self._socketIoConnections[clientId];
		failFast.unlessTrue(socket !== undefined, `attempted to look up socket that isn't connected: [${clientId}]`);
		return socket;
	}

	function failFastIfHttpServerClosed() {
		throw new Error(
			"Do not call httpServer.stop() when using RealTimeServer--it will trigger this bug: " +
			"https://github.com/socketio/socket.io/issues/2975"
		);
	}


	class NullHttpServer {
		getNodeServer() {
			return {
				on: noOp,
				removeListener: noOp
			};
		}
	}

	class NullIoServer {
		on() {}
		emit() {}
		close(done) { return done(); }
	}

	class NullSocket {
		constructor(id) { this.id = id; }
		get isNull() { return true; }
		emit() {}
		get broadcast() { return { emit: noOp }; }
	}

	function nullIo() {
		return new NullIoServer();
	}

	function noOp() {}

}());