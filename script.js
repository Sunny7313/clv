const socket = io('http://localhost:3001');

require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.36.1/min/vs' }});

require(['vs/editor/editor.main'], function () {
    const editor = monaco.editor.create(document.getElementById('monacoEditor'), {
        value: '',
        language: 'cpp',
        theme: 'vs-dark',
        fontSize: 18
    });
 
    const output_terminal = monaco.editor.create(document.getElementById('output-terminal'), {
        value: '',
        language: 'text',
        theme: 'vs-dark',
        fontSize: 18
    });

    document.getElementById('run-code').addEventListener('click', () => {
        const code = editor.getValue();
        const language = document.getElementById('language-select').value;
        
        if (!code) {
            alert('Please enter some code to run.');
            return;
        }
        output_terminal.setValue('');
        socket.emit('code', { code, language });
    });

    socket.on('output', (data) => {
        const currentValue = output_terminal.getValue();
        output_terminal.setValue(currentValue + '\n' + data);

        // Update the stored content whenever new output is received
        sample = output_terminal.getValue().trim();
    });
    let sample = output_terminal.getValue().trim();

    output_terminal.onKeyDown((event) => {
        if (event.keyCode === monaco.KeyCode.Enter) {
            event.preventDefault();
            let currentContent = output_terminal.getValue().trim();
            let userInput = currentContent.replace(sample, '').trim();
            if (userInput) {
                console.log("USER GAVE THIS TO ME: " + userInput);
                socket.emit('input', userInput);
                sample = currentContent;
            }
        }
    });

    socket.on('video', (videoPath) => {
        const videoElement = document.getElementById('generated-video');
        videoElement.src = `./videos/` + videoPath;
        videoElement.style.display = 'block';
    });

    document.getElementById('feedback-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const feedbackText = document.getElementById('feedback-text').value;
        if (feedbackText) {
            socket.emit('feedback', feedbackText);
            alert('Thank you for your feedback!');
            document.getElementById('feedback-text').value = '';
        } else {
            alert('Please enter your feedback before submitting.');
        }
    });
});
