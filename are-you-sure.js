/**
 * AreYouSure - A tricky confirmation popup.
 * Users must read the Betty Botter poem and answer a random question correctly.
 *
 * Usage:
 *   AreYouSure.confirm().then(confirmed => {
 *     if (confirmed) { // proceed }
 *   });
 *
 *   // Or with a custom message:
 *   AreYouSure.confirm("Delete this item?").then(confirmed => { ... });
 */
const AreYouSure = (() => {
  const POEM_SETS = [
    {
      poem: `Betty Botter bought some butter,
But she said the butter's bitter.
"If I put it in my batter,
It will make my batter bitter.
But a bit of better butter—
That would make my batter better."
So she bought a bit of butter,
Better than her bitter butter,
And she put it in her batter,
And the batter was not bitter.
So 'twas better Betty Botter
Bought a bit of better butter.`,
      questions: [
        {
          question: "Why was Betty unhappy with her first purchase?",
          options: [
            "It was too expensive.",
            "It was too bitter.",
            "It was too salty.",
            "It was melted."
          ],
          answer: 1
        },
        {
          question: "What would happen if she used the bitter butter?",
          options: [
            "The batter would become bitter.",
            "The cake would not rise.",
            "The batter would turn green.",
            "The oven would smoke."
          ],
          answer: 0
        },
        {
          question: "What did Betty buy to solve the problem?",
          options: [
            "More sugar.",
            "A new mixing bowl.",
            "A bit of better butter.",
            "A different brand of flour."
          ],
          answer: 2
        },
        {
          question: "How did the final batter taste?",
          options: [
            "It was still bitter.",
            "It was not bitter.",
            "It was too sweet.",
            "The poem doesn't say."
          ],
          answer: 1
        },
        {
          question: 'Why was it "better" that Betty bought the second bit of butter?',
          options: [
            "Because she got it on sale.",
            "Because she liked shopping.",
            "Because it made her batter better.",
            "Because she ran out of the first batch."
          ],
          answer: 2
        }
      ]
    },
    {
      poem: `Peter Piper picked a peck of pickled peppers.
A peck of pickled peppers Peter Piper picked.
If Peter Piper picked a peck of pickled peppers,
Where's the peck of pickled peppers Peter Piper picked?`,
      questions: [
        {
          question: "What did Peter Piper pick?",
          options: [
            "A bunch of bananas.",
            "A peck of pickled peppers.",
            "A basket of apples.",
            "A pile of potatoes."
          ],
          answer: 1
        },
        {
          question: "What unit of measurement is used for the peppers?",
          options: [
            "A pound.",
            "A bushel.",
            "A peck.",
            "A barrel."
          ],
          answer: 2
        },
        {
          question: "What is the poem's final question?",
          options: [
            "Who ate the peppers?",
            "Why did he pick peppers?",
            "Where are the pickled peppers he picked?",
            "How many peppers did he pick?"
          ],
          answer: 2
        },
        {
          question: "What condition were the peppers in when Peter picked them?",
          options: [
            "Fresh.",
            "Rotten.",
            "Pickled.",
            "Dried."
          ],
          answer: 2
        },
        {
          question: "How many times is Peter Piper's full name mentioned in the poem?",
          options: [
            "Once.",
            "Twice.",
            "Three times.",
            "Four times."
          ],
          answer: 2
        }
      ]
    }
  ];

  const LABELS = ["A", "B", "C", "D"];

  function injectStyles() {
    if (document.getElementById("ays-styles")) return;
    const style = document.createElement("style");
    style.id = "ays-styles";
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
      .ays-overlay {
        position: fixed;
        inset: 0;
        background: rgba(255, 255, 255, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        animation: ays-fade-in 0.3s ease-out;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      @keyframes ays-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .ays-dialog {
        background: #fff;
        border: 1px solid #e0e0e0;
        border-radius: 0;
        max-width: 520px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
        font-family: 'Space Grotesk', -apple-system, sans-serif;
        color: #1a1a1a;
        animation: ays-slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .ays-dialog::-webkit-scrollbar { width: 4px; }
      .ays-dialog::-webkit-scrollbar-track { background: #fff; }
      .ays-dialog::-webkit-scrollbar-thumb { background: #ccc; }
      @keyframes ays-slide-up {
        from { transform: translateY(30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .ays-header {
        padding: 28px 28px 0;
        border-bottom: none;
      }
      .ays-header h2 {
        margin: 0 0 6px;
        font-family: 'Space Mono', monospace;
        font-size: 13px;
        font-weight: 700;
        color: #d93025;
        text-transform: uppercase;
        letter-spacing: 3px;
      }
      .ays-header p {
        margin: 0;
        font-size: 12px;
        color: #999;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .ays-prompt-msg {
        margin: 16px 28px 0;
        padding: 12px 16px;
        background: transparent;
        border: 1px solid #d93025;
        border-radius: 0;
        font-family: 'Space Mono', monospace;
        font-size: 12px;
        font-weight: 400;
        color: #d93025;
        letter-spacing: 0.5px;
      }
      .ays-poem {
        margin: 20px 28px;
        padding: 20px;
        background: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 0;
        white-space: pre-line;
        font-family: 'Space Mono', monospace;
        font-size: 12px;
        line-height: 1.9;
        font-style: normal;
        color: #555;
        letter-spacing: 0.3px;
      }
      .ays-question {
        margin: 0 28px 20px;
      }
      .ays-question p {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 14px;
        font-weight: 500;
        margin: 0 0 14px;
        color: #000;
        letter-spacing: 0.2px;
      }
      .ays-option {
        display: block;
        width: 100%;
        text-align: left;
        padding: 12px 16px;
        margin-bottom: 4px;
        border: 1px solid #e0e0e0;
        border-radius: 0;
        background: transparent;
        font-family: 'Space Mono', monospace;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s ease;
        color: #555;
        letter-spacing: 0.3px;
      }
      .ays-option:hover {
        border-color: #000;
        color: #000;
        background: rgba(0, 0, 0, 0.02);
      }
      .ays-option.ays-selected {
        border-color: #000;
        color: #000;
      }
      .ays-option.ays-correct {
        border-color: #2e7d32;
        background: #e8f5e9;
        color: #1b5e20;
      }
      .ays-option.ays-wrong {
        border-color: #d93025;
        background: #fbe9e7;
        color: #d93025;
      }
      .ays-feedback {
        margin: 0 28px 16px;
        padding: 12px 16px;
        border-radius: 0;
        font-family: 'Space Mono', monospace;
        font-size: 11px;
        font-weight: 400;
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 2px;
        display: none;
      }
      .ays-feedback.ays-show { display: block; }
      .ays-feedback.ays-success {
        background: #e8f5e9;
        border: 1px solid #c8e6c9;
        color: #1b5e20;
      }
      .ays-feedback.ays-error {
        background: #fbe9e7;
        border: 1px solid #d93025;
        color: #d93025;
      }
      .ays-actions {
        padding: 16px 28px 28px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .ays-btn {
        padding: 12px 28px;
        border: 1px solid #e0e0e0;
        border-radius: 0;
        font-family: 'Space Mono', monospace;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        text-transform: uppercase;
        letter-spacing: 2px;
      }
      .ays-btn-cancel {
        background: transparent;
        color: #999;
        border-color: #e0e0e0;
      }
      .ays-btn-cancel:hover {
        color: #000;
        border-color: #000;
      }
      .ays-btn-confirm {
        background: transparent;
        color: #ccc;
        border-color: #e0e0e0;
        opacity: 0.3;
        pointer-events: none;
      }
      .ays-btn-confirm.ays-enabled {
        opacity: 1;
        pointer-events: auto;
        background: #000;
        color: #fff;
        border-color: #000;
      }
      .ays-btn-confirm.ays-enabled:hover {
        background: #d93025;
        color: #fff;
        border-color: #d93025;
      }
    `;
    document.head.appendChild(style);
  }

  function pickRandom() {
    const set = POEM_SETS[Math.floor(Math.random() * POEM_SETS.length)];
    const question = set.questions[Math.floor(Math.random() * set.questions.length)];
    return { poem: set.poem, question };
  }

  function confirm(promptMessage) {
    injectStyles();

    return new Promise((resolve) => {
      const { poem, question: q } = pickRandom();
      let answered = false;
      let correct = false;

      const overlay = document.createElement("div");
      overlay.className = "ays-overlay";

      const dialog = document.createElement("div");
      dialog.className = "ays-dialog";

      // Header
      dialog.innerHTML = `
        <div class="ays-header">
          <h2>Are you sure?</h2>
          <p>Read the poem below, then answer the question to confirm.</p>
        </div>
        ${promptMessage ? `<div class="ays-prompt-msg">${promptMessage}</div>` : ""}
        <div class="ays-poem">${poem}</div>
        <div class="ays-question">
          <p>${q.question}</p>
        </div>
        <div class="ays-feedback"></div>
        <div class="ays-actions">
          <button class="ays-btn ays-btn-cancel">Cancel</button>
          <button class="ays-btn ays-btn-confirm">Confirm</button>
        </div>
      `;

      overlay.appendChild(dialog);

      const questionDiv = dialog.querySelector(".ays-question");
      const feedback = dialog.querySelector(".ays-feedback");
      const confirmBtn = dialog.querySelector(".ays-btn-confirm");
      const cancelBtn = dialog.querySelector(".ays-btn-cancel");

      // Render options
      q.options.forEach((opt, i) => {
        const btn = document.createElement("button");
        btn.className = "ays-option";
        btn.textContent = `${LABELS[i]}) ${opt}`;
        btn.addEventListener("click", () => {
          if (answered) return;
          answered = true;

          if (i === q.answer) {
            correct = true;
            btn.classList.add("ays-correct");
            feedback.textContent = "Correct! You may now confirm.";
            feedback.className = "ays-feedback ays-show ays-success";
            confirmBtn.classList.add("ays-enabled");
          } else {
            btn.classList.add("ays-wrong");
            // highlight correct answer
            questionDiv.querySelectorAll(".ays-option")[q.answer].classList.add("ays-correct");
            feedback.textContent = "Wrong answer. You can cancel and try again.";
            feedback.className = "ays-feedback ays-show ays-error";
          }
        });
        questionDiv.appendChild(btn);
      });

      function cleanup(result) {
        overlay.remove();
        resolve(result);
      }

      cancelBtn.addEventListener("click", () => cleanup(false));
      confirmBtn.addEventListener("click", () => {
        if (correct) cleanup(true);
      });

      // Close on overlay click (outside dialog)
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cleanup(false);
      });

      // Close on Escape
      function onKey(e) {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", onKey);
          cleanup(false);
        }
      }
      document.addEventListener("keydown", onKey);

      document.body.appendChild(overlay);
    });
  }

  return { confirm };
})();

// Support ES module and CommonJS exports
if (typeof module !== "undefined" && module.exports) {
  module.exports = AreYouSure;
}
