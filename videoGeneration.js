const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const generateVideoFromDescription = (description, videoPath, callback) => {
    const tempTextPath = path.join(path.dirname(videoPath), 'description.txt');

    fs.writeFile(tempTextPath, description, (err) => {
        if (err) {
            return callback(err);
        }
       

        // Escape backslashes for Windows paths
        const escapedTextPath = tempTextPath.replace(/\\/g, '\\\\');
        const escapedVideoPath = videoPath.replace(/\\/g, '\\\\');

        // FFmpeg command to create video with text from file
        const ffmpegCommand = `ffmpeg -f lavfi -i color=c=black:s=640x480:d=5 -vf "drawtext=textfile=${tempTextPath}:fontcolor=white:fontsize=24" -y ${videoPath}`;
        console.log('\n\nFFmpeg command:', ffmpegCommand);
        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                return callback(error);
            }
            if (stderr) {
                console.error('FFmpeg stderr:', stderr);
            }
            fs.unlink(tempTextPath, (err) => {
                if (err) {
                    console.error('Error deleting temp text file:', err);
                }
            });
            callback(null);
        });
    });
};

module.exports = { generateVideoFromDescription };
