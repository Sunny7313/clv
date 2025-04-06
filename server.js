const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const fsx = require("fs-extra");
const path = require("path");
const os = require("os");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { generateVideoFromDescription } = require('./videoGeneration');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3001;

app.use("/videos", express.static(path.join(__dirname, "videos")));

const genAI = new GoogleGenerativeAI("AIzaSyADEn687CQrR1CK8tr_UJftRguU3DQcy1Y");
const tempDir = path.join(__dirname, "temp");
const videosDir = path.join(__dirname, "videos");
const descriptionFile = path.join(videosDir, "description.txt");

// Ensure directories exist
const ensureDirectoryExists = (dirPath) => {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
};

ensureDirectoryExists(tempDir);
ensureDirectoryExists(videosDir);

const killProcess = (filePath) => {
	const platform = os.platform();

	if (platform === "win32") {
		const command = `taskkill /f /im ${path.basename(filePath)}`;
		exec(command, (err, stdout, stderr) => {
			if (err) {
				console.error(`Failed to kill process for ${filePath}: ${err.message}`);
			} else {
				console.log(`Killed process for ${filePath}`);
			}
		});
	} else if (platform === "linux" || platform === "darwin") {
		const command = `pkill -f ${path.basename(filePath)}`;
		exec(command, (err, stdout, stderr) => {
			if (err) {
				console.error(`Failed to kill process for ${filePath}: ${err.message}`);
			} else {
				console.log(`Killed process for ${filePath}`);
			}
		});
	} else {
		console.error(`Unsupported platform: ${platform}`);
	}
};

const deleteFile = (filePath, retries = 3) => {
	if (retries === 0) {
		console.error(`Failed to delete file: ${filePath}`);
		return;
	}

	try {
		fs.unlinkSync(filePath);
	} catch (err) {
		if (err.code === "EPERM" || err.code === "EBUSY") {
			setTimeout(() => deleteFile(filePath, retries - 1), 500);
		} else {
			console.error(err);
		}
	}
};

const cleanUpOldFiles = () => {
	const oldFiles = ["temp_cpp", "temp_c"].map((fileName) =>
		path.join(
			tempDir,
			os.platform() === "win32" ? `${fileName}.exe` : fileName,
		),
	);
	oldFiles.forEach((filePath) => {
		if (fs.existsSync(filePath)) {
			console.log("Found old file: " + filePath);
			killProcess(filePath);
			deleteFile(filePath);
		}
	});
};

cleanUpOldFiles();

app.use(express.static(__dirname));
app.use("/videos", express.static(videosDir));
let codel;
io.on("connection", (socket) => {
	console.log("User connected");

	socket.on("code", async (data) => {
		if (!data || !data.code || !data.language) {
			console.error("Invalid data received:", data);
			socket.emit("output", "Invalid data received.");
			return;
		}

		const { code, language } = data;
		console.log("Received code:", code, "Language:", language);
		let fileName, execFileName, compileCommand;
		if (language === "cpp") {
			fileName = "temp.cpp";
			execFileName = "temp_cpp";
			compileCommand = `g++ ${fileName} -o ${execFileName}`;
		} else if (language === "c") {
			fileName = "temp.c";
			execFileName = "temp_c";
			compileCommand = `gcc ${fileName} -o ${execFileName}`;
		} else if (language === "java") {
			const classNameMatch = code.match(/class\s+(\w+)/);
			if (classNameMatch) {
				fileName = `${classNameMatch[1]}.java`;
				execFileName = classNameMatch[1];
				compileCommand = `cd ${tempDir} && javac ${fileName}`;
			} else {
				socket.emit("output", "Invalid Java code: No class name found.");
				return;
			}
		} else if (language === "javascript") {
			fileName = "temp.js";
			execFileName = "temp_js";
			compileCommand = null; 
		} else if (language === "python") {
			fileName = "temp.py";
			execFileName = "temp_py";
			compileCommand = null; // No compilation needed for Python
		} else {
			socket.emit("output", "Unsupported language.");
			return;
		}

		const filePath = path.join(tempDir, fileName);
		codel = code;
		const execFilePath = path.join(
			tempDir,
			os.platform() === "win32" ? `${execFileName}.exe` : execFileName,
		);
		cleanUpOldFiles();

		try {
			await fs.promises.writeFile(filePath, code);
			await fs.promises.access(filePath, fs.constants.F_OK);
			console.log("File written successfully:", filePath);
			const executionCommand =
				language === "python"
					? `python "${filePath}"`
					: language === "java"
					? `java -cp ${tempDir} ${execFileName}`
					: language === "javascript"
					? `node "${filePath}"`
					: execFilePath;
			const compileProcess = compileCommand
				? spawn(compileCommand, { cwd: tempDir, shell: true })
				: null;

			if (compileProcess) {
				compileProcess.on("close", (code) => {
					if (code === 0) {
						executeCode(executionCommand, socket);
					} else {
						socket.emit("output", `Compilation failed with code ${code}`);
					}
				});
			} else {
				executeCode(executionCommand, socket);
			}
		} catch (err) {
			console.error("Error handling file operations:", err);
			socket.emit("output", `Error handling file operations: ${err.message}`);
		}
	});

	socket.on("generateVideo", (description) => {
		const videoPath = path.join(videosDir, `video_${Date.now()}.mp4`);
		generateVideoFromDescription(description, videoPath, (err) => {
			if (err) {
				console.error("Error generating video:", err);
				socket.emit("videoError", "Error generating video.");
			} else {
				socket.emit("video", path.basename(videoPath));
			}
		});
	});
});

const executeCode = (command, socket) => {
	console.log(`Executing command: ${command}`);
	const execution = spawn(command, { cwd: tempDir, shell: true });

	execution.stdout.on("data", (data) => {
		const output = data.toString();
		console.log("OUTPUT RECEIVED: " + output);
		socket.emit("output", output);
	});

	execution.stderr.on("data", (data) => {
		const errorOutput = data.toString();
		console.error("Execution error output:", errorOutput);
		socket.emit("output", errorOutput);
	});

	execution.on("close", (code) => {
		console.log(`Execution finished with code ${code}`);
		if (code !== 0) {
			let errorMessage = `Execution failed with code ${code}`;
			if (code === 11) {
				errorMessage += " (Segmentation fault)";
			}
			socket.emit("output", errorMessage);
		}
	});

	execution.on("error", (err) => {
		console.error("Execution error:", err);
		socket.emit("output", `Execution error: ${err.message}`);
	});

	if (execution.stdin.writable) {
		socket.on("input", (userInput) => {
			if (execution.stdin.writable) {
				execution.stdin.write(userInput + "\n");
			} else {
				console.error("Stdin is not writable");
			}
		});
	}
};

server.listen(port, (err) => {
	if (err) {
		console.error(`Failed to start server on port ${port}: ${err.message}`);
		process.exit(1);
	} else {
		console.log(`Server is listening on port ${port} \nhttp://localhost:${port}`);
	}
});
