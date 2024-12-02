function BO2camera(thisObj) {

  // -------------------Global variables-------------------

	// About
	var name = "BO2 Cam to AE";
	var version = "1.0";

	// Misc
	var alertMessage = [];

	function buildUI(thisObj) {

    // -------------------UI-------------------

		var myPanel = (thisObj instanceof Panel) ? thisObj : new Window("palette", name + " " + version, undefined, { resizeable: true });

		res = "group\
    {\
      orientation:'column',  alignment:['fill','center'], alignChildren:['fill','fill'],\
      addCameraGroup: Group\
      {\
        orientation:'column', alignChildren:['fill','center'],\
        buttonAdd: Button{text: 'Import BO2 .t6cr Camera'}\
      }\
      settingsGroup: Group\
      {\
        orientation:'row', alignment:['right','center'],\
        helpButton: Button{text: '?', maximumSize:[25,25]},\
      }\
    }";

    // Add UI elements to the panel
    myPanel.grp = myPanel.add(res);
    // Refresh the panel
    myPanel.layout.layout(true);
    // Set minimal panel size
    myPanel.grp.minimumSize = myPanel.grp.size;
    // Add panel resizing function 
    myPanel.layout.resize();
    myPanel.onResizing = myPanel.onResize = function () {
        this.layout.resize();
    }

    // -------------------Buttons-------------------

		myPanel.grp.addCameraGroup.buttonAdd.onClick = function () {
			AddCameraToLayer();
		}

    myPanel.grp.settingsGroup.helpButton.onClick = function () {
      alertCopy(
        'T6GR: https://airyz.xyz/p/t6gr\n' +
				'\n' +
        'BO2 Camera Importer: https://github.com/eirisocherry/bo2-cam-to-ae\n' +
				'\n' +
				'Camera time remapping: https://github.com/eirisocherry/camera-time-remapping'
      );
    }

		return myPanel;
	}

  // -------------------Buttons-------------------

	function createCamera(selectedLayer) {
		var camName = "BO2_CAM: " + selectedLayer.name;
		var existingCam = app.project.activeItem.layers.byName(camName);

		// If the camera already exists, add an index to create a new unique camera
		if (existingCam) {
			var index = 1;
			// Increase index until a unique camera name is found
			while (app.project.activeItem.layers.byName(camName + " (" + index + ")")) {
				index++;
			}
			camName += " (" + index + ")";
		}

		// Create a new camera layer
		var outCam = app.project.activeItem.layers.addCamera("tmp", [app.project.activeItem.width / 2, app.project.activeItem.height / 2]);
		outCam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
		outCam.name = camName;
		outCam.startTime = selectedLayer.startTime;
		outCam.inPoint = selectedLayer.inPoint;
		outCam.outPoint = selectedLayer.outPoint;
		return outCam;
	}

	function AddCameraToLayer() {

		// -------------------Checkers-------------------

		var comp = app.project.activeItem;
		var selectedLayers = app.project.activeItem.selectedLayers;

		if (!(comp instanceof CompItem)) {
			alert("Open a composition first.");
			return;
		}

		if (selectedLayers.length !== 1) {
			alert("Select a single source video.");
			return;
		}

		if (selectedLayers[0].source == undefined || selectedLayers[0].source.frameRate == 0 || selectedLayers[0].source.duration == 0) {
			alert("Selected layer isn't a video, please select a source video.");
			return;
		}

		var selectedLayer = selectedLayers[0];

		// -------------------Import camera file-------------------

		app.beginUndoGroup("Add Camera");

		// Read camera file
		var cameraFile = File.openDialog();
		if (!cameraFile || !cameraFile.open("r")) {
			alert("Failed to open file.");
			return;
		}

		// Check the file extension
		var fileExtension = cameraFile.name.split('.').pop();
		if (fileExtension.toLowerCase() !== "t6cr") {
			alert(
				"Incorrect file extension: ." + fileExtension + "\n" + 
				"Please, select a .t6cr file."
			);
			return;
		}

		// Parse the file
		var fileLines = [];
		while(!cameraFile.eof){
			var line = cameraFile.readln();
			var split = line.split(",");
			var value = [];
			value.push(parseFloat(split[0]));
			value.push(parseFloat(split[1]));
			value.push(parseFloat(split[2]));
			value.push(parseFloat(split[3]));
			value.push(parseFloat(split[4]));
			value.push(parseFloat(split[5]));
			value.push(parseFloat(split[6]));
			fileLines.push(value);
		}

		cameraFile.close();

		// -------------------Frames checker-------------------

		var frames = fileLines.length;
		var frameRate = selectedLayer.source.frameRate;
		var duration = selectedLayer.source.duration;
		var expectedFrames = Math.round(duration * frameRate);

		// Check for frame mismatch
		if (Math.abs(frames - expectedFrames) > 1) {
			var continueScript = confirm(
				"Frame mismatch.\n" +
				"\n" +
				"File frames: " + frames + "\n" +
				"Composition frames: " + expectedFrames + " (Duration: " + duration.toFixed(2) + "s, Frame rate: " + frameRate + "fps)\n" +
				"\n" +
				"Possible solutions:\n"+
				"- Make sure composition fps = source fps\n" +
				"- Select a correct source layer\n" +
				"- Open correct camera data file for your cinematic\n" +
				"\n" +
				"Do you want to continue anyway?"
			);

			if (!continueScript) {
				return;
			}
		}

		// Check for time remapping
		if (selectedLayer.timeRemapEnabled) {
			var continueScript = confirm(
				"Error: Seems like you've selected the correct camera data, but because time remapping is applied to the selected layer, your camera data won't match the video.\n" +
				"\n" +
				"Please, remove time remapping from the selected layer.\n" +
				"\n"+
				"If you have camera time remapping script, ignore the warning and press yes.\n" +
				"\n" +
				"Ignore the warning?"
			);

			if (!continueScript) {
				return;
			}
		}
		
		// -------------------Camera-------------------

		var camera = createCamera(selectedLayer);
		var positions = [];
		var xRotations = [];
		var yRotations = [];
		var zRotations = [];
		var zooms = [];
		var times = [];

		/*
		
		# BO2 to AE axes conversion
		Note: Axes describe both positions and rotations

		BO2 -> AE
		X   ->  Z
		Y   -> -X
		Z   -> -Y
		
		BO2 -> AE (Sorted by AE ZYX Euler)
		Z   -> -Y
		Y   -> -X
		X   ->  Z
		AE rotations apply order = YXZ (y orientation -> x rotation -> z rotation)

		AE  -> BO2
		X   -> -Y
		Y   -> -Z
		Z   ->  X
		AE rotations = BO2[-Y, -Z, X];
		
		*/

		// Extract information from selected file
		for (var i = 0; i < frames; i++) {
			var frameIndex = selectedLayer.startTime * frameRate + i;
			var time = frameIndex / frameRate;

			var X = fileLines[i][1];
			var Y = fileLines[i][2];
			var Z = fileLines[i][3];

			//Rotations in the file are written in PYR order (pitch yaw roll)
			//BO2 PYR = BO2 YZX
			var xR = fileLines[i][6];
			var yR = fileLines[i][4];
			var zR = fileLines[i][5];

			function toHfov(FOV, width, height) {
				var engineAspectRatio = width / height;
				var defaultAspectRatio = 4 / 3;
				var ratio = engineAspectRatio / defaultAspectRatio;
				var FOVhalf = Math.tan(FOV/2 * (Math.PI / 180)) * ratio;
				var hFOV = 2.0 * Math.atan(FOVhalf) * (180 / Math.PI);
				return hFOV;
			}
			var fov = fileLines[i][0];
			var hFOV = toHfov(fov, comp.width, comp.height);
			var zoom = (comp.width/2.0) / Math.tan((hFOV * Math.PI / 180.0)/2.0);

			times.push(time);
			positions.push([-Y, -Z, X]);
			xRotations.push(-yR);
			yRotations.push([0, -zR, 0]);
			zRotations.push(xR);
			zooms.push(zoom);
		}

		camera.position.setValuesAtTimes(times, positions);
		camera.orientation.setValuesAtTimes(times, yRotations);
		camera.rotationX.setValuesAtTimes(times, xRotations);
		camera.rotationZ.setValuesAtTimes(times, zRotations);
		camera.zoom.setValuesAtTimes(times, zooms);

		// -------------------Center null-------------------

		// Calculate the average position
		var avgPos = [0.0, 0.0, 0.0];
		for (var k = 0; k < positions.length; k++) {
			avgPos[0] += positions[k][0];
			avgPos[1] += positions[k][1];
			avgPos[2] += positions[k][2];
		}
		avgPos[0] /= positions.length;
		avgPos[1] /= positions.length;
		avgPos[2] /= positions.length;

		// Get unique name
		var centerNullName = "Center: " + selectedLayer.name;
		if (comp.layers.byName(centerNullName)) {
			var index = 1;
			while (comp.layers.byName(centerNullName + " (" + index + ")")) {
				index++;
			}

			centerNullName += " (" + index + ")";
		}

		// Create a null at the center of the camera path
		var centerNull = comp.layers.addNull();
		centerNull.name = centerNullName;
		centerNull.source.name = centerNullName;
		centerNull.threeDLayer = true;
		centerNull.startTime = selectedLayer.startTime;
		centerNull.inPoint = selectedLayer.inPoint;
		centerNull.outPoint = selectedLayer.outPoint;
		centerNull.position.setValue(avgPos);

		setHoldInterpolation(camera);

		alert("BO2 camera has been successfully imported.")

		app.endUndoGroup();
	}

	// -------------------Functions-------------------

	function setHoldInterpolationForProperty(prop) {
		if (prop.isTimeVarying) {
				for (var j = 1; j <= prop.numKeys; j++) {
						prop.setInterpolationTypeAtKey(j, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
				}
		}
	}

	function setHoldInterpolation(group) {
		for (var i = 1; i <= group.numProperties; i++) {
			var prop = group.property(i);
			
			if (prop.propertyType === PropertyType.PROPERTY) {
				setHoldInterpolationForProperty(prop);
			} else if (prop.propertyType === PropertyType.INDEXED_GROUP || prop.propertyType === PropertyType.NAMED_GROUP) {
				setHoldInterpolation(prop);
			}
		}
	}

	function alertPush(message) {
		alertMessage.push(message);
	}

	function alertShow(message) {

			alertMessage.push(message);

			if (alertMessage.length === 0) {
					return;
			}

			var allMessages = alertMessage.join("\n\n")

			var dialog = new Window("dialog", "Debug");
			var textGroup = dialog.add("group");
			textGroup.orientation = "column";
			textGroup.alignment = ["fill", "top"];

			var text = textGroup.add("edittext", undefined, allMessages, { multiline: true, readonly: true });
			text.alignment = ["fill", "fill"];
			text.preferredSize.width = 300;
			text.preferredSize.height = 300;

			var closeButton = textGroup.add("button", undefined, "Close");
			closeButton.onClick = function () {
					dialog.close();
			};

			dialog.show();

			alertMessage = [];

	}

	function alertCopy(message) {

			if (message === undefined || message === "") {
					return;
			}

			var dialog = new Window("dialog", "Information");
			var textGroup = dialog.add("group");
			textGroup.orientation = "column";
			textGroup.alignment = ["fill", "top"];

			var text = textGroup.add("edittext", undefined, message, { multiline: true, readonly: true });
			text.alignment = ["fill", "fill"];
			text.preferredSize.width = 300;
			text.preferredSize.height = 150;

			var closeButton = textGroup.add("button", undefined, "Close");
			closeButton.onClick = function () {
					dialog.close();
			};

			dialog.show();

			alertMessage = [];

	}

	// -------------------Show UI-------------------

	var myScriptPal = buildUI(thisObj);
	if ((myScriptPal != null) && (myScriptPal instanceof Window)) {
			myScriptPal.center();
			myScriptPal.show();
	}
	if (this instanceof Panel)
			myScriptPal.show();
	}
BO2camera(this);