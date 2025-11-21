"""
doe/__init__.py

This module initializes the Flask application, sets up configuration settings,
and handles API routes.
"""

import os
import whisper
from flask import Flask, jsonify, request, Response, send_from_directory
from flask_cors import CORS
from rag_system import DOEOracle

# Initialize DOE Oracle
expert = DOEOracle(model_name="CombinatorialExpert")

# Load Whisper model (free + local)
whisper_model = whisper.load_model("base")

# Construct absolute paths to the papers
base_dir = os.path.abspath(os.path.dirname(__file__))
paper_paths = [
    os.path.join(base_dir, "..", "instance/research_papers/Applying_Combinatorial_Testing_in_Industrial_Settings.pdf"),
    os.path.join(base_dir, "..", "instance/research_papers/How does combinatorial testing perform in the real world.pdf"),
    os.path.join(base_dir, "..", "instance/research_papers/improving mc&dc and fault detection strength using combinatorial testing.pdf.pdf")
]

# Check if vector store exists
vector_store_path = os.path.join(base_dir, "..", "instance/vector_store")
if not os.path.exists(vector_store_path) or not os.listdir(vector_store_path):
    print("Vector store not found, loading papers...")
    expert.load_papers(paper_paths)
    print("Papers loaded successfully.")
else:
    print("Loading existing vector store...")
    expert.load_vector_store()
    print("Vector store loaded successfully.")


def create_app(test_config=None):
    """Initialize Flask app"""

    app = Flask(__name__, instance_relative_config=True)

    # CORS config
    cors = CORS(
        app,
        resources={r"/api/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5173"]}}
    )

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get('Origin')
        if origin in ['http://localhost:5173', 'http://127.0.0.1:5173']:
            response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        return response

    # Serve frontend
    app.config.from_mapping(
        SECRET_KEY='dev',
        FRONTEND_DIR=os.path.join(os.path.dirname(os.path.dirname(__file__)), 'doe-frontend', 'dist')
    )

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve_frontend(path):
        target = os.path.join(app.config['FRONTEND_DIR'], path)
        if path != "" and os.path.exists(target):
            return send_from_directory(app.config['FRONTEND_DIR'], path)
        return send_from_directory(app.config['FRONTEND_DIR'], 'index.html')

    # API: SEARCH
    @app.route('/api/search', methods=['POST'])
    def search():
        try:
            data = request.get_json()
            if not data or 'query' not in data:
                return jsonify({'error': 'Query required'}), 400

            response = expert.query(data['query'])
            return jsonify({
                "summary": response.get("text"),
                "results": response.get("evidence", [])
            })

        except Exception as e:
            print("Error /api/search:", e)
            return jsonify({'error': 'Internal server error'}), 500

    # API: CHAT STREAM
    @app.route('/api/chat', methods=['POST'])
    def chat():
        try:
            data = request.get_json()
            if not data or 'message' not in data:
                return jsonify({'error': 'No message provided'}), 400

            def generate():
                response = expert.query(data['message'])
                words = response["text"].split()
                for word in words:
                    yield f"data: {word}\n\n"

                if "evidence" in response:
                    import json
                    yield f"data: {json.dumps({'type': 'evidence','data': response['evidence']})}\n\n"

            return Response(generate(), mimetype="text/event-stream")

        except Exception as e:
            print("Error /api/chat:", e)
            return jsonify({"error": "Internal server error"}), 500

    # API: SPEECH-TO-TEXT (WHISPER)
    @app.route('/api/stt', methods=['POST'])
    def stt():
        try:
            if "audio" not in request.files:
                return jsonify({"error": "No audio uploaded"}), 400

            audio_file = request.files["audio"]

            size = len(audio_file.read())    # read to check size
            print("Received:", audio_file.filename, "size:", size)
            audio_file.seek(0)               # reset pointer after read


            # Save audio to temp file
			import tempfile
			with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
				audio_file.save(tmp.name)
				temp_path = tmp.name

            # Transcribe with Whisper
            result = whisper_model.transcribe(temp_path)
            os.remove(temp_path)

            return jsonify({"text": result["text"]})

        except Exception as e:
            print("Error /api/stt:", e)
            return jsonify({"error": "Internal server error"}), 500

    return app
