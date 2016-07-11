#TicketMiner Server
Copyright (C) 2016 - Christof Torres, University of Luxembourg

License/usage:
=========================
This software is released under the terms of the MIT license, a copy
of which should be included with this distribution.
This software is provided "AS IS", without any warranties of any kind,
either expressed or implied.

About
=========================
TicketMiner Server is a proof-of-concept, that acts as a proxy between TicketMiner clients and a mining pool. It coordinates all the communication between client and mining pool, in addition it provides improved services to clients in exchange for mined tickets.

Screenshots
-----------
### Dashboard
![Dashboard](https://raw.githubusercontent.com/christoftorres/TicketMiner/master/Server/screenshots/screen-dashboard%20.png?raw=true "Dashboard")

Installation instructions
=========================
There are some prerequisites before being able to install the TicketMiner Server software. You will have to have Node.js and the node package manager npm pre-installed on your system. Node.js is an open source Javascript runtime environment for easily building server-side and networking applications.

There are two ways to get Node.js and npm:

1. Download and install Node.js from [nodejs.org](https://nodejs.org/en/). Node.js includes npm.
2. Or, if you have a package manager like APT, install Node.js and npm via that. For example, in an Ubuntu or Debian terminal window, enter: ***sudo apt-get install nodejs nodejs-legacy npm***

After you have Node.js and npm installed, you need to first compile and install the unomp-multi-hashing library for your system. You can do this with the help of npm, by simply navigating inside the console to the "Server" directory and running the following command:

	npm install ./lib/unomp-multi-hashing

Afterwards, you need to install all the necessary dependencies. You can once again use npm for that, just run the following command inside the console from the "Server" directory containing the _package.json_ file:

	npm install

Finally, you still need to change the default configuration of the server before running it. Open the config.json file and modify the ***host*** field with your servers hostname or IP address and the also modify the ***port*** field with the port number where you want to make your service available to the public.

Running instructions
====================
If you just want to test if the software works, just run this node command inside the "Server" directory:

	node server.js

**Note**: Running a Node.js application in this manner will block additional commands until the application is killed by pressing _CTRL+C_.

If you want to run the application in a production environment, you will need to install PM2, which is a process manager for Node.js applications. PM2 provides an easy way to manage and daemonize applications (run them as a service), so they will automatically restart on reboot or failure. Use this command to install PM2:

	sudo npm install pm2 -g

Finally, you can use the pm2 start command to run the Node.js application, _server.js_, in the background:

	pm2 start server.js
