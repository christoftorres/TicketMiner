#TicketMiner Addon
Copyright (C) 2016 - Christof Torres

License/usage:
=========================
This software is released under the terms of the MIT license, a copy
of which should be included with this distribution.
This software is provided "AS IS", without any warranties of any kind,
either expressed or implied.

About
=========================
TicketMiner is a proof-of-concept and JavaScript based multi-threaded 
cryptocurrency miner for Mozilla Firefox, allowing users to mine tickets at 
dedicated websites where they can later on redeem these tickets for improved services.

Installation instructions
=========================
There are two ways to install the TicketMiner add-on:

1. Compile the source and install the plugin
2. Install the plugin directly from the builds

Compile the source and install the plugin
-----------------------------------------

In order to "compile" the source code to a Mozilla Firefox add-on,
you only need to run the following command inside the console:

	jpm xpi

This command packages the add-on as an XPI file, which is the install 
file format for Mozilla Firefox add-ons.

jpm is distributed with the node package manager npm.

There are two ways to get npm:

	1. Download and install Node.js from [nodejs.org](https://nodejs.org/en/). Node.js includes npm.
	2. Or, if you have a package manager like APT, install npm via that. For example, in an Ubuntu or Debian terminal window, enter:

		sudo apt-get install nodejs nodejs-legacy npm

After you have npm installed, install jpm just as you would install any other npm package:

	npm install jpm --global

Finally, to install the compiled add-on, just drag and drop the XPI
file into the Mozilla Firefox browser. A popup window will appear asking your approval to install. Click "Install" and you are done. Enjoy!

Install the plugin directly from the builds
-------------------------------------------
To install the plugin directly from the builds, just drag and drop the already pre-compiled XPI file contained inside the "builds" folder into the Mozilla Firefox browser. A popup window will appear asking your approval to install. Click "Install" and enjoy!
