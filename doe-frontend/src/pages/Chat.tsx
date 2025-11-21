// src/components/Chat.tsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import doeLogo from '../assets/images/doe-logo-final.png';
import { HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline';
import { MicrophoneIcon } from '@heroicons/react/24/outline';
import { SpeakerWaveIcon } from '@heroicons/react/24/outline';

import man from '../assets/images/man.png';
import man2 from '../assets/images/man2.png';

interface Message {
  sender: 'system' | 'bot' | 'user';
  text: string;
  isSearchResult?: boolean;
  searchResults?: SearchResultItem[];
  searchSummary?: string;
  originalQuery?: string;
}

interface SearchResultItem {
  id: string;
  title: string;
  link: string;
  snippet: string;
}

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState('Ask DOE anything...');

  // STT / recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  // ----- Search / RAG call -----
  const handleSearch = async (query?: string) => {
    const userQuery = query ?? searchInput;
    if (!userQuery.trim()) return;

    // Add user message immediately
    setMessages((prev) => [...prev, { sender: 'user', text: userQuery, originalQuery: userQuery }]);

    // Clear the input field immediately after adding the user message
    setSearchInput('');

    setLoading(true);
    setError(null);

    let responseClone: Response | null = null;

    try {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000';
      const response = await fetch(`${backendUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userQuery }),
      });

      responseClone = response.clone();
      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: '',
          isSearchResult: true,
          searchSummary: data.summary,
          searchResults: data.results,
          originalQuery: userQuery,
        },
      ]);
    } catch (err) {
      console.error('Search Error:', err);

      if (responseClone) {
        try {
          const rawText = await responseClone.text();
          console.error('Raw response text:', rawText);
        } catch (textErr) {
          console.error('Could not get raw response text:', textErr);
        }
      } else {
        console.error('Response object was not available for reading raw text.');
      }

      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during search.';
      if (err instanceof SyntaxError && responseClone?.status === 404) {
        setError(`API endpoint not found (404). Please check the server route.`);
        setMessages((prev) => [...prev, { sender: 'system', text: `Error: API endpoint /api/search not found (404).` }]);
      } else {
        setError(errorMessage);
        setMessages((prev) => [...prev, { sender: 'system', text: `Error searching for "${userQuery}": ${errorMessage}` }]);
      }
    } finally {
      setLoading(false);
    }
  };

  // ----- Clipboard / feedback helpers -----
  const handleCopy = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy)
      .then(() => console.log('Text copied to clipboard!'))
      .catch(err => console.error('Failed to copy text: ', err));
  };

  const handleFeedback = (messageContent: string, rating: 'up' | 'down') => {
    console.log(`Feedback received: ${rating} for message starting with: "${messageContent.substring(0, 50)}..."`);
  };

  // ----- STT: start / stop / send -----
  const startRecording = async () => {
    try {
      // Request microphone permission and get stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

  // Force a codec that Whisper + Chrome both support
    const mediaRecorder = new MediaRecorder(stream, {mimeType: "audio/webm"});

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Combine chunks into a single blob (wav/webm)
	const audioBlob = new Blob(audioChunksRef.current, {type: mediaRecorderRef.current.mimeType});
        await sendAudioToBackend(audioBlob);

        // Stop all tracks on the stream to free the mic
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setPlaceholder('Listening...');
    } catch (err) {
      console.error('Error starting recording:', err);
      setPlaceholder('Ask DOE anything...');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.error('Error stopping media recorder:', err);
      }
    }
    setIsRecording(false);
    // restore placeholder shortly after stopping (give a small delay while upload happens)
    setTimeout(() => setPlaceholder('Ask DOE anything...'), 500);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  const sendAudioToBackend = async (blob: Blob) => {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000';

    console.log("Sent audio blob:", blob.type, blob.size);  // ← DEBUG LOG


    const formData = new FormData();
	formData.append("audio", blob, "recording.webm");

    try {
      const response = await fetch(`${backendUrl}/api/stt`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        console.error('STT server error:', response.status, bodyText);
        setError('Speech-to-text failed.');
        return;
      }

      const data = await response.json();
      if (data?.text) {
        // Insert transcription into the input
        setSearchInput(data.text);
        // Optionally auto-send - currently we just fill input. Uncomment next line to auto-send:
        // handleSearch(data.text);
      } else {
        console.warn('No transcription text returned from server.');
      }
    } catch (err) {
      console.error('STT Error:', err);
      setError('Speech-to-text error occurred.');
    }
  };

  // ----- Render -----
  return (
    <div className="flex flex-col max-w-6xl mx-auto px-2 sm:px-4 py-2 sm:py-4 min-h-screen">
      <div className="text-white font-bold text-4xl text-center pb-10">DOE ORACLE</div>

      <div className="flex-1 flex flex-col bg-gradient-to-br from-gray-900 to-black rounded-xl border border-violet-900/30 shadow-lg shadow-violet-900/20 p-3 sm:p-6 mb-4 sm:mb-6 overflow-hidden">
        <div className="flex items-center justify-center space-x-32">
          <div className="pt-10 text-white font-bold text-4xl text-center pb-10">
            ORACLE
            <img src={man} alt="Oracle" className="h-[200px] pt-10 object-contain" />
          </div>
          <div className="pt-10 text-white font-bold text-4xl text-center pb-10">
            USER
            <img src={man2} alt="User" className="h-[200px] pt-10 object-contain" />
          </div>
        </div>

        <div className="overflow-y-auto pr-2 sm:pr-4 flex-1 space-y-4 sm:space-y-6">
          <AnimatePresence>
            {messages.map((message, index) => (
              message.sender === 'user' ? (
                <motion.div
                  key={`${index}-user`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex w-full mb-4 pt-10"
                >
                  <div className="flex justify-center w-1/2 ml-auto">
                    <div className="bg-purple-600 text-white p-3 sm:p-4 rounded-lg max-w-xs sm:max-w-lg md:max-w-2xl">
                      {message.text}
                    </div>
                  </div>
                </motion.div>
              ) : message.sender === 'bot' ? (
                <motion.div
                  key={`${index}-bot-${message.isSearchResult}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex w-full pl-20"
                >
                  <div className="flex justify-center w-1/2">
                    <div className="flex items-start space-x-4">
                      <div className="bg-gray-800 p-3 sm:p-5 rounded-lg border border-blue-600/50 flex-1">
                        {message.text && (
                          <p className={`text-base mb-4 leading-relaxed ${message.isSearchResult ? 'font-semibold text-blue-300' : 'text-gray-200'}`}>
                            {message.text}
                          </p>
                        )}

                        {message.searchSummary && (
                          <p className="text-base text-gray-200 mb-3 italic border-l-2 border-blue-400 pl-2">
                            {message.searchSummary}
                          </p>
                        )}

                        {message.searchResults && (
                          <ul className="space-y-2 mb-3">
                            {message.searchResults.map((result: SearchResultItem, resultIndex: number) => (
                              <li key={result.id || `${index}-result-${resultIndex}`} className="text-xs">
                                <a
                                  href={result.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 hover:underline font-medium"
                                >
                                  {result.title}
                                </a>
                                <p className="text-gray-400 mt-1" dangerouslySetInnerHTML={{ __html: result.snippet }} />
                              </li>
                            ))}
                          </ul>
                        )}

                        {(message.searchSummary || (!message.isSearchResult && message.text)) && (
                          <div className="mt-3 pt-2 border-t border-gray-700/50 flex items-center space-x-2">
                            <button
                              onClick={() => handleCopy(message.searchSummary || message.text)}
                              className="text-xs text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-gray-700"
                              title="Copy"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>

                            <button
                              onClick={() => handleFeedback(message.searchSummary || message.text, 'up')}
                              className="text-xs text-gray-400 hover:text-green-400 p-1 rounded hover:bg-gray-700"
                              title="Helpful"
                            >
                              <HandThumbUpIcon className="h-4 w-4" />
                            </button>

                            <button
                              onClick={() => handleFeedback(message.searchSummary || message.text, 'down')}
                              className="text-xs text-gray-400 hover:text-red-400 p-1 rounded hover:bg-gray-700"
                              title="Not Helpful"
                            >
                              <HandThumbDownIcon className="h-4 w-4" />
                            </button>

                            <button
                              className="text-xs text-gray-400 hover:text-blue-400 p-2 rounded hover:bg-gray-700"
                              title="Listen"
                            >
                              <SpeakerWaveIcon className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={`${index}-system`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center text-xs text-gray-500 italic py-2"
                >
                  {message.text}
                </motion.div>
              )
            ))}
          </AnimatePresence>

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="mt-auto p-3 sm:p-5 bg-gray-800 rounded-xl border border-blue-500/30">
        <div className="flex space-x-2 sm:space-x-3 items-center">
          {/* Microphone: tap to toggle recording */}
          <button
            onClick={toggleRecording}
            className={`${
              isRecording ? 'bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
            } text-white font-bold py-2 sm:py-3 px-4 sm:px-6 rounded-full transition-colors duration-200 flex items-center justify-center`}
            title={isRecording ? 'Stop recording' : 'Start recording'}
          >
            <MicrophoneIcon className="h-8 w-8" />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-gray-700 text-white rounded-lg px-3 sm:px-5 py-2 sm:py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 text-sm sm:text-base"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSearch(searchInput);
              }
            }}
            disabled={loading}
          />

          <button
            onClick={() => handleSearch(searchInput)}
            disabled={loading || !searchInput.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 sm:py-3 px-4 sm:px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 text-sm sm:text-base"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-white mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : 'Send'}
          </button>
        </div>

        {error && <p className="text-red-500 text-xs mt-2 px-1">{error}</p>}
      </div>

      {/* AI Disclaimer */}
      <div className="mt-8 p-5 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
        <div className="flex items-start space-x-3">
          <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <h3 className="text-sm font-semibold text-yellow-400 mb-2">Important Disclaimer</h3>
            <p className="text-sm text-yellow-200/80 leading-relaxed">
              DOE is an AI research assistant that may occasionally generate inaccurate, incomplete, or misleading information.
              Always verify important information and consult original research papers for critical decisions.
              Responses are based solely on Dr. Wong's available research papers and may not reflect the complete state of the field.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;
