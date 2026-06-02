from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import json
import re
import os
import random
from datetime import datetime
from dotenv import load_dotenv

# ===============================
# Load environment variables
# ===============================
load_dotenv() 

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app, origins=['*'])

# ===============================
# GROQ API CONFIGURATION
# ===============================
# Put your key in .env as:
# GROQ_API_KEY=your_key_here
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "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").strip()
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()

# ===============================
# QUESTION COUNT MAPPING BASED ON DURATION
# ===============================
DURATION_QUESTION_MAP = {
    15: {"min": 8, "max": 12, "default": 10},
    30: {"min": 15, "max": 20, "default": 18},
    45: {"min": 20, "max": 28, "default": 24},
    60: {"min": 25, "max": 35, "default": 30},
    90: {"min": 35, "max": 45, "default": 40},
    120: {"min": 45, "max": 55, "default": 50}
}

# ===============================
# DIFFICULTY LEVEL SETTINGS
# ===============================
DIFFICULTY_SETTINGS = {
    "Beginner": {
        "time_per_question": 45,
        "complexity": "basic conceptual questions",
        "focus_areas": ["fundamentals", "basic concepts", "entry-level knowledge"]
    },
    "Intermediate": {
        "time_per_question": 60,
        "complexity": "moderate difficulty with practical scenarios",
        "focus_areas": ["problem-solving", "real-world applications", "best practices"]
    },
    "Advanced": {
        "time_per_question": 90,
        "complexity": "complex, expert-level questions",
        "focus_areas": ["system design", "optimization", "architecture decisions", "edge cases"]
    }
}


def normalize_interview_type(value: str) -> str:
    """Normalize interview type to backend canonical keys."""
    if not value:
        return "technical"
    v = value.strip().lower()

    mapping = {
        "technical": "technical",
        "tech": "technical",

        "hr": "hr",
        "human resource": "hr",
        "behavioral": "hr",

        "aptitude": "aptitude",
        "logical": "aptitude",
        "reasoning": "aptitude",

        "general": "general",
        "mock": "mock",

        "non_technical": "non_technical",
        "non-technical": "non_technical"
    }
    return mapping.get(v, "technical")


def normalize_difficulty(value: str) -> str:
    if not value:
        return "Intermediate"
    v = value.strip().lower()
    if v == "beginner":
        return "Beginner"
    if v == "advanced":
        return "Advanced"
    return "Intermediate"


def safe_int(value, default=0, min_val=None, max_val=None):
    try:
        x = int(value)
    except Exception:
        x = default
    if min_val is not None:
        x = max(min_val, x)
    if max_val is not None:
        x = min(max_val, x)
    return x


def calculate_question_count(duration_minutes, mode='duration', manual_count=None):
    """Calculate number of questions based on duration or manual input."""
    if mode == 'questions' and manual_count is not None:
        return min(max(int(manual_count), 3), 60)  # Between 3 and 60 questions

    # Find exact duration mapping
    if duration_minutes in DURATION_QUESTION_MAP:
        config = DURATION_QUESTION_MAP[duration_minutes]
        return random.randint(config["min"], config["max"])

    # Default calculation if duration not in map (1 question per 2 minutes)
    return max(5, min(50, duration_minutes // 2))


def ask_groq(prompt, system_message=None, temperature=0.7, max_tokens=2000):
    """Call Groq API with the given prompt."""
    if not GROQ_API_KEY:
        print("⚠️ No Groq API key found. Using local mode.")
        return None

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens
    }

    try:
        response = requests.post(GROQ_API_URL, headers=headers, json=payload, timeout=40)

        if response.status_code == 200:
            data = response.json()
            if "choices" in data and len(data["choices"]) > 0:
                return data["choices"][0]["message"]["content"]
            print(f"Unexpected response format: {data}")
            return None
        else:
            print(f"Groq API error: {response.status_code} - {response.text[:500]}")
            return None

    except requests.exceptions.Timeout:
        print("Groq API timeout")
        return None
    except Exception as e:
        print(f"Groq API error: {str(e)}")
        return None


def generate_local_questions(interview_type, sub_category, difficulty, count):
    """Enhanced local question generation with dynamic content."""
    # Canonical type
    interview_type = normalize_interview_type(interview_type)
    difficulty = normalize_difficulty(difficulty)

    # Expanded question banks
    question_banks = {
        'technical': {
            'beginner': [
                f"What is your experience level with {sub_category} development?",
                f"What are the basic concepts you've learned as a {sub_category} developer?",
                "Explain the difference between interpreted and compiled languages.",
                "What is version control and why is it important?",
                "Describe your understanding of object-oriented programming."
            ],
            'intermediate': [
                f"What are the key technologies you've mastered as a {sub_category} Developer?",
                "Explain a complex technical problem you solved recently.",
                "How do you ensure code quality and maintainability in your projects?",
                "Describe your experience with API design and integration.",
                "What's your approach to debugging production issues?"
            ],
            'advanced': [
                f"Discuss a challenging architectural decision you made in your {sub_category} projects.",
                "How would you design a scalable system for millions of users?",
                "Explain your experience with microservices vs monolithic architecture.",
                "Describe a time you optimized a slow-performing system.",
                "What strategies do you use for handling technical debt?"
            ]
        },
        'non_technical': {
            'beginner': [
                "Tell me about yourself and your educational background.",
                "Why did you choose this career path?",
                "What motivates you to perform well at work?",
                "How do you prioritize your daily tasks?"
            ],
            'intermediate': [
                "Describe a time you faced a challenge at work and how you overcame it.",
                "How do you handle constructive criticism?",
                "Tell me about a successful team project you were part of.",
                "How do you manage multiple deadlines simultaneously?"
            ],
            'advanced': [
                "Describe a situation where you had to influence stakeholders.",
                "How have you handled a major failure or setback professionally?",
                "Tell me about a time you mentored a junior team member.",
                "Describe your approach to conflict resolution in a team."
            ]
        },
        'aptitude': {
            'beginner': [
                "If a train travels 360 km in 4 hours, what is its speed in m/s?",
                "What is 15% of 200?",
                "Find the average of first 10 natural numbers."
            ],
            'intermediate': [
                "A man buys a cycle for ₹1400 and sells at 15% loss. Find selling price.",
                "Find the next number: 2, 6, 12, 20, ?",
                "If 5 workers complete a task in 12 days, how many days will 3 workers take?"
            ],
            'advanced': [
                "A shopkeeper offers 20% discount on ₹500 item. Find selling price.",
                "What is the compound interest on ₹1000 at 10% for 2 years?",
                "A boat travels 30 km upstream in 5 hours. Find speed of stream."
            ]
        },
        'hr': {
            'beginner': [
                "Tell me about yourself and your background.",
                "Why are you interested in this position?",
                "What are your career goals for the next 2 years?"
            ],
            'intermediate': [
                "What are your greatest strengths and how do they apply to this role?",
                "Describe a time you received difficult feedback.",
                "How do you handle stress and pressure at work?"
            ],
            'advanced': [
                "Tell me about a time you had to make a difficult decision.",
                "How do you handle competing priorities from multiple stakeholders?",
                "Describe your leadership style with examples."
            ]
        },
        # General + Mock as mixed pools
        'general': {
            'beginner': [
                "Tell me about yourself in a concise way.",
                "What is one skill you are currently improving and why?",
                "How do you plan your day to stay productive?"
            ],
            'intermediate': [
                "Explain a project you are proud of and your exact contribution.",
                "How do you learn a new tool quickly under time pressure?",
                "Describe a time you solved a real-world problem with limited resources."
            ],
            'advanced': [
                "How would you evaluate trade-offs when choosing between speed and quality?",
                "Describe a strategic decision you made and its measurable impact.",
                "If a project is behind schedule, how do you recover without compromising quality?"
            ]
        },
        'mock': {
            'beginner': [
                "Give your 60-second self-introduction for an interview.",
                "Why should we hire you for this role?",
                "What are your key strengths relevant to this position?"
            ],
            'intermediate': [
                "Tell me about a challenge and how you solved it with a structured approach.",
                "Describe your resume project with tech stack, problems, and outcome.",
                "How would your manager describe your work style?"
            ],
            'advanced': [
                "If you disagree with your lead’s technical decision, what will you do?",
                "Describe a failure and how you converted it into a learning outcome.",
                "How do you prioritize impact when everything seems urgent?"
            ]
        }
    }

    diff_key = difficulty.lower()  # beginner/intermediate/advanced
    questions = question_banks.get(interview_type, question_banks['technical']).get(diff_key, [])

    # If insufficient, borrow from nearby levels
    while len(questions) < count and len(questions) < 80:
        if diff_key == 'beginner':
            questions.extend(question_banks.get(interview_type, {}).get('intermediate', [])[:5])
        elif diff_key == 'intermediate':
            questions.extend(question_banks.get(interview_type, {}).get('advanced', [])[:3])
            questions.extend(question_banks.get(interview_type, {}).get('beginner', [])[:2])
        else:
            questions.extend(question_banks.get(interview_type, {}).get('intermediate', [])[:5])

        # Final fallback from technical if pool empty
        if not questions:
            questions.extend(question_banks['technical'].get('intermediate', []))

    random.shuffle(questions)
    return questions[:count]


def evaluate_local_answer(question, answer, difficulty):
    """Enhanced local evaluation with difficulty-based scoring."""
    word_count = len(answer.split())
    difficulty = normalize_difficulty(difficulty)

    if difficulty == "Beginner":
        target_length = 30
        max_score = 8
    elif difficulty == "Advanced":
        target_length = 60
        max_score = 10
    else:
        target_length = 45
        max_score = 9

    if word_count < 15:
        marks = max(2, min(5, word_count // 3))
        accuracy = 40 + (word_count * 2)
        feedback = "Your answer was brief. Could you provide more details and examples?"
        strengths = ["Basic understanding of the topic"]
        improvements = ["Provide more detailed explanation", "Add specific examples"]
    elif word_count < target_length:
        ratio = word_count / target_length
        marks = max(5, int(8 * ratio))
        accuracy = 55 + int(30 * ratio)
        feedback = "Good start! Adding specific examples would strengthen your answer."
        strengths = ["Clear communication", "Good effort"]
        improvements = ["Add specific examples", "Provide more details"]
    else:
        marks = max(7, min(max_score, 7 + (word_count - target_length) // 15))
        accuracy = 75 + min(20, (word_count - target_length) // 3)
        feedback = "Well-structured answer! You covered the key points well."
        strengths = ["Good structure", "Clear communication", "Relevant points covered"]
        improvements = ["Could add more examples", "Expand on key points"]

    ans = answer.lower()
    if "example" in ans:
        marks = min(max_score, marks + 1)
        accuracy = min(98, accuracy + 5)
        strengths.append("Used relevant examples")
    if "because" in ans or "reason" in ans:
        marks = min(max_score, marks + 1)
        accuracy = min(98, accuracy + 3)
        strengths.append("Provided reasoning")
    if any(word in ans for word in ["first", "second", "third", "finally", "moreover"]):
        strengths.append("Good logical flow")

    return marks, feedback, accuracy, strengths[:3], improvements[:3]


def extract_json_from_text(text: str):
    """Try robust JSON extraction from model output."""
    if not text:
        return None

    # 1) direct parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # 2) fenced json block
    fenced = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except Exception:
            pass

    # 3) first JSON-like object
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        candidate = match.group(0)
        try:
            return json.loads(candidate)
        except Exception:
            # Attempt minimal cleanup for trailing commas
            cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
            try:
                return json.loads(cleaned)
            except Exception:
                return None
    return None


# ===============================
# SERVE FRONTEND FILES
# ===============================
@app.route('/')
def serve_login():
    return send_from_directory('../frontend', 'login.html')


@app.route('/dashboard.html')
def serve_dashboard():
    return send_from_directory('../frontend', 'dashboard.html')


@app.route('/interview-home.html')
def serve_interview():
    return send_from_directory('../frontend', 'interview-home.html')


@app.route('/student-profile.html')
def serve_profile():
    return send_from_directory('../frontend', 'student-profile.html')


@app.route('/css/<path:filename>')
def serve_css(filename):
    return send_from_directory('../frontend/css', filename)


@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_from_directory('../frontend/js', filename)


# ===============================
# API ENDPOINTS
# ===============================
@app.route('/test', methods=['GET'])
def test_connection():
    return jsonify({'status': 'ok', 'message': 'Server is reachable'})


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'message': 'Server is running',
        'timestamp': datetime.now().isoformat(),
        'groq_api': 'configured' if GROQ_API_KEY else 'not configured',
        'model': MODEL
    })


@app.route('/generate_questions', methods=['POST'])
def generate_questions():
    try:
        data = request.get_json(silent=True) or {}

        interview_type_raw = data.get('interview_type', 'technical')
        interview_type = normalize_interview_type(interview_type_raw)
        sub_category = (data.get('sub_category', 'Python') or 'Python').strip()
        difficulty = normalize_difficulty(data.get('difficulty', 'Intermediate'))
        mode = (data.get('mode', 'questions') or 'questions').strip().lower()

        # New personalization fields
        experience_years = safe_int(data.get('experience_years', 0), default=0, min_val=0, max_val=40)
        target_company = (data.get('target_company', '') or '').strip()
        preferred_language = (data.get('preferred_language', 'English') or 'English').strip()
        key_skills = (data.get('key_skills', '') or '').strip()
        prep_notes = (data.get('prep_notes', '') or '').strip()

        # Calculate question count based on mode
        if mode == 'duration':
            duration = safe_int(data.get('duration', 30), default=30, min_val=10, max_val=180)
            count = calculate_question_count(duration, 'duration')
        else:
            count = safe_int(data.get('count', 10), default=10, min_val=3, max_val=60)

        print(f"Generating {count} questions | type={interview_type} | role={sub_category} | diff={difficulty}")

        if interview_type == 'technical':
            type_text = f"technical {sub_category} developer position"
        elif interview_type == 'non_technical':
            type_text = "non-technical/soft skills position"
        elif interview_type == 'aptitude':
            type_text = "aptitude and logical reasoning test"
        elif interview_type == 'hr':
            type_text = "HR behavioral and culture-fit interview"
        elif interview_type == 'mock':
            type_text = f"mock interview for {sub_category} role"
        else:
            type_text = "general interview"

        difficulty_config = DIFFICULTY_SETTINGS.get(difficulty, DIFFICULTY_SETTINGS["Intermediate"])

        personalization = f"""
Candidate profile:
- Experience: {experience_years} years
- Target company: {target_company if target_company else 'Not specified'}
- Preferred language: {preferred_language}
- Key skills: {key_skills if key_skills else 'Not specified'}
- Preparation notes: {prep_notes if prep_notes else 'Not specified'}
"""

        prompt = f"""Generate exactly {count} {difficulty} level interview questions for a {type_text}.

Requirements:
- Questions should be relevant to Indian IT industry
- Difficulty style: {difficulty_config['complexity']}
- Focus areas: {', '.join(difficulty_config['focus_areas'])}
- Professional, practical, interview-ready wording
- Do NOT repeat similar questions
- Keep each question in one line, concise and clear

{personalization}

Return ONLY the questions, numbered 1 to {count}, each on a new line.
Do not add headings or explanations."""

        result = ask_groq(prompt, temperature=0.65, max_tokens=2200)

        questions = []
        if result:
            lines = result.strip().split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue

                # Accept numbered or bullet lines
                if line[0].isdigit() or line.startswith('-') or line.startswith('*'):
                    cleaned = re.sub(r'^\d+[\.\)]\s*', '', line)
                    cleaned = re.sub(r'^[-*]\s*', '', cleaned)
                else:
                    cleaned = line

                cleaned = cleaned.strip()
                if cleaned and len(cleaned) > 8:
                    questions.append(cleaned)

            # De-duplicate while preserving order
            deduped = []
            seen = set()
            for q in questions:
                key = q.lower()
                if key not in seen:
                    seen.add(key)
                    deduped.append(q)
            questions = deduped

        if len(questions) < count:
            print(f"Groq returned {len(questions)} valid questions, using local fallback.")
            questions = generate_local_questions(interview_type, sub_category, difficulty, count)

        if len(questions) > count:
            questions = questions[:count]

        time_per_question = difficulty_config["time_per_question"]
        expected_duration_minutes = max(1, (count * time_per_question) // 60)

        return jsonify({
            'success': True,
            'questions': questions,
            'total_questions': len(questions),
            'expected_duration_minutes': expected_duration_minutes,
            'time_per_question_seconds': time_per_question
        })

    except Exception as e:
        print(f"Error in generate_questions: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/evaluate_answer', methods=['POST'])
def evaluate_answer():
    try:
        data = request.get_json(silent=True) or {}
        question = (data.get('question', '') or '').strip()
        answer = (data.get('answer', '') or '').strip()
        difficulty = normalize_difficulty(data.get('difficulty', 'Intermediate'))

        if not answer or len(answer) < 10:
            return jsonify({
                'success': True,
                'marks': 0,
                'feedback': '❌ Answer too short. Please provide a more detailed response.',
                'accuracy': 0,
                'strengths': ['None'],
                'improvements': ['Provide more detailed answer']
            })

        system_prompt = """You are an expert interviewer from a top Indian tech company.
Evaluate candidate answers strictly but fairly.

Return ONLY valid JSON in this exact schema:
{
  "marks": number between 0 and 10,
  "feedback": "brief constructive feedback",
  "accuracy": number between 0 and 100,
  "strengths": ["strength1", "strength2"],
  "improvements": ["improvement1", "improvement2"]
}

No extra text outside JSON."""

        user_prompt = f"""Question: {question}
Difficulty: {difficulty}
Candidate Answer: {answer}

Scoring weights:
- Accuracy and correctness: 40%
- Completeness and depth: 30%
- Clarity and communication: 30%

Return only JSON."""

        result = ask_groq(user_prompt, system_prompt=system_prompt, temperature=0.2, max_tokens=700)

        marks, feedback, accuracy, strengths, improvements = 0, "", 0, [], []

        if result:
            eval_data = extract_json_from_text(result)
            if eval_data and isinstance(eval_data, dict):
                marks = float(eval_data.get('marks', 0) or 0)
                feedback = str(eval_data.get('feedback', 'No feedback provided'))
                accuracy = float(eval_data.get('accuracy', marks * 10) or (marks * 10))
                strengths = eval_data.get('strengths', ['Good effort'])
                improvements = eval_data.get('improvements', ['Provide more details'])
                if not isinstance(strengths, list):
                    strengths = ['Good effort']
                if not isinstance(improvements, list):
                    improvements = ['Provide more details']
            else:
                print("Failed to parse model JSON, using local evaluation.")
                marks, feedback, accuracy, strengths, improvements = evaluate_local_answer(question, answer, difficulty)
        else:
            marks, feedback, accuracy, strengths, improvements = evaluate_local_answer(question, answer, difficulty)

        marks = max(0, min(10, marks))
        accuracy = max(0, min(100, accuracy))

        # Score badge
        if marks >= 8.5:
            feedback = f"🏆 EXCELLENT! {feedback}"
        elif marks >= 7:
            feedback = f"🌟 GREAT! {feedback}"
        elif marks >= 6:
            feedback = f"👍 GOOD! {feedback}"
        elif marks >= 4:
            feedback = f"📚 {feedback}"
        else:
            feedback = f"💪 NEEDS IMPROVEMENT! {feedback}"

        return jsonify({
            'success': True,
            'marks': round(marks, 2),
            'feedback': feedback,
            'accuracy': round(accuracy, 2),
            'strengths': strengths[:3],
            'improvements': improvements[:3]
        })

    except Exception as e:
        print(f"Error in evaluate_answer: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'marks': 0,
            'feedback': '⚠️ Evaluation failed. Please try again.',
            'accuracy': 0,
            'strengths': [],
            'improvements': []
        }), 500


# ===============================
# ADDITIONAL UTILITY ENDPOINTS
# ===============================
@app.route('/api/question-count', methods=['POST'])
def get_question_count():
    """Get recommended question count based on duration."""
    try:
        data = request.get_json(silent=True) or {}
        duration = safe_int(data.get('duration', 60), default=60, min_val=10, max_val=180)
        mode = (data.get('mode', 'duration') or 'duration').strip().lower()
        manual_count = data.get('count', None)

        if mode == 'questions':
            count = safe_int(manual_count, default=10, min_val=3, max_val=60)
        else:
            count = calculate_question_count(duration, mode='duration')

        difficulty = normalize_difficulty(data.get('difficulty', 'Intermediate'))
        time_per_question = DIFFICULTY_SETTINGS.get(difficulty, DIFFICULTY_SETTINGS["Intermediate"])["time_per_question"]

        return jsonify({
            'success': True,
            'recommended_questions': count,
            'estimated_duration_minutes': max(1, (count * time_per_question) // 60),
            'time_per_question_seconds': time_per_question
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/interview-stats', methods=['GET'])
def get_interview_stats():
    """Get interview configuration statistics."""
    return jsonify({
        'success': True,
        'difficulty_levels': list(DIFFICULTY_SETTINGS.keys()),
        'duration_options': list(DURATION_QUESTION_MAP.keys()),
        'question_ranges': DURATION_QUESTION_MAP,
        'groq_status': 'connected' if GROQ_API_KEY else 'disconnected',
        'model': MODEL
    })


if __name__ == '__main__':
    print("\n" + "=" * 70)
    print("🤖 InterVU AI INTERVIEW SYSTEM - PROFESSIONAL EDITION".center(70))
    print("=" * 70)
    print("🚀 Server initializing...".center(70))
    print("=" * 70)
    print("\n📊 INTERVIEW CONFIGURATION:")
    print("   • Duration-based questions: 15min→8-12 | 30min→15-20 | 60min→25-35 | 90min→35-45 | 120min→45-55")
    print("   • Difficulty levels: Beginner (45s/q) | Intermediate (60s/q) | Advanced (90s/q)")
    print(f"   • Groq API: {'✅ CONFIGURED' if GROQ_API_KEY else '❌ NOT CONFIGURED'}")
    print(f"   • Model: {MODEL}")
    print("\n" + "=" * 70 + "\n")

    # 1. Fetch the port dynamically allocated by Render
    # 2. Bind host to '0.0.0.0' so it accepts external requests from the web
    # 3. Disable debug mode in production to ensure stability on Render
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
