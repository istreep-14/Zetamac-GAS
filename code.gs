const KEY_TO_MODE_AND_DURATION = {
  '72740d67': { mode: 'Normal', duration: 30 },
  '0172800b': { mode: 'Normal', duration: 60 },
  'a7220a92': { mode: 'Normal', duration: 120 },
  '215bc31a': { mode: 'Normal', duration: 300 },
  '97382c35': { mode: 'Normal', duration: 600 },
  'c9750470': { mode: 'Hard', duration: 30 },
  'ac954fea': { mode: 'Hard', duration: 60 },
  '5ae295b0': { mode: 'Hard', duration: 120 },
  '04e52452': { mode: 'Hard', duration: 300 },
  '7ca8f568': { mode: 'Hard', duration: 600 }
};

function extractKeyFromUrl(url) {
  if (!url) return '';
  const match = url.match(/[?&]key=([a-f0-9]+)/i);
  return match ? match[1] : '';
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActive();
  const sessionsSheet = ss.getSheetByName('Sessions') || ss.insertSheet('Sessions');

  ensureSessionsHeaders_(sessionsSheet);

  const url = data.url || '';
  const key = extractKeyFromUrl(url);
  const mapping = KEY_TO_MODE_AND_DURATION[key] || null;
  const detectedMode = mapping ? mapping.mode : '';
  const mappedDuration = mapping ? mapping.duration : '';

  sessionsSheet.appendRow([
    new Date(),
    data.clientId || '',
    url,
    data.duration || '',
    data.score || '',
    JSON.stringify(data.problems || []),
    detectedMode,
    mappedDuration,
  ]);

  const newRow = sessionsSheet.getLastRow();
  const score120Cell = sessionsSheet.getRange(newRow, 9); // I column
  score120Cell.setFormula('=IFERROR((E' + newRow + '/D' + newRow + ')*120, "")');

  ensureScore120Formulas_(sessionsSheet);
  appendProblemsRows_(ss, data, {
    timestamp: sessionsSheet.getRange(newRow, 1).getValue(),
    clientId: data.clientId || '',
    url: url,
    detectedMode: detectedMode,
    mappedDuration: mappedDuration,
    duration: data.duration || '',
    score: data.score || ''
  });

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function ensureSessionsHeaders_(sheet) {
  const headers = [
    'Timestamp',
    'ClientId',
    'URL',
    'Duration',
    'Score',
    'ProblemsJson',
    'Mode',
    'MappedDuration',
    'Score_120'
  ];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return;
  }
  const firstRowRange = sheet.getRange(1, 1, 1, headers.length);
  const existing = firstRowRange.getValues()[0];
  let needsUpdate = false;
  for (var i = 0; i < headers.length; i++) {
    if ((existing[i] || '') !== headers[i]) {
      needsUpdate = true;
      break;
    }
  }
  if (needsUpdate) {
    firstRowRange.setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function ensureScore120Formulas_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // no data rows
  const formulaCol = 9; // I
  const dataRange = sheet.getRange(2, 1, lastRow - 1, formulaCol);
  const values = dataRange.getValues();
  const formulas = sheet.getRange(2, formulaCol, lastRow - 1, 1).getFormulas();

  var formulasToSet = [];
  for (var r = 0; r < values.length; r++) {
    var duration = values[r][3]; // column D (0-indexed in this row array)
    var score = values[r][4]; // column E
    var currentFormula = formulas[r][0];
    var shouldSet = !currentFormula; // empty formula cell
    if (shouldSet && (duration !== '' || score !== '')) {
      formulasToSet.push(['=IFERROR((E' + (r + 2) + '/D' + (r + 2) + ')*120, "")']);
    } else {
      formulasToSet.push([currentFormula || '']);
    }
  }
  sheet.getRange(2, formulaCol, lastRow - 1, 1).setFormulas(formulasToSet);
}

function appendProblemsRows_(ss, data, context) {
  var problems = Array.isArray(data.problems) ? data.problems : [];
  if (!problems.length) return;
  var sheet = ss.getSheetByName('Problems') || ss.insertSheet('Problems');
  ensureProblemsHeaders_(sheet);

  var rows = [];
  for (var i = 0; i < problems.length; i++) {
    var p = problems[i] || {};
    var normalized = normalizeProblem_(p);
    rows.push([
      context.timestamp,
      context.clientId,
      normalized.operation,
      normalized.a,
      normalized.b,
      normalized.c,
      context.duration,
      context.score,
      context.detectedMode,
      context.mappedDuration,
      context.url,
      i + 1
    ]);
  }
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function ensureProblemsHeaders_(sheet) {
  const headers = [
    'Timestamp',
    'ClientId',
    'Operation',
    'a',
    'b',
    'c',
    'Duration',
    'Score',
    'Mode',
    'MappedDuration',
    'URL',
    'ProblemIndex'
  ];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return;
  }
  const firstRowRange = sheet.getRange(1, 1, 1, headers.length);
  const existing = firstRowRange.getValues()[0];
  let needsUpdate = false;
  for (var i = 0; i < headers.length; i++) {
    if ((existing[i] || '') !== headers[i]) {
      needsUpdate = true;
      break;
    }
  }
  if (needsUpdate) {
    firstRowRange.setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function normalizeProblem_(problem) {
  // Allow flexible inputs: objects, strings, or token arrays
  var parsedFromExpression = extractFromProblemGuess_(problem);

  var operation = normalizeOperationSymbol_(
    (problem && (problem.operation || problem.op || problem.type || problem.symbol ||
    problem.operator || problem.operationType || problem.category || problem.kind || problem.sign)) ||
    (parsedFromExpression && parsedFromExpression.operation) || ''
  );

  // Support common field aliases for the two given values and any provided answer
  var first = toNumber_(
    (problem && (problem.a ?? problem.first ?? problem.value1 ?? problem.firstValue ?? problem.num1 ??
    problem.x ?? problem.left ?? problem.lhs ?? problem.leftValue ??
    problem.minuend ?? problem.dividend ?? problem.start ?? problem.initial)) ??
    (parsedFromExpression ? parsedFromExpression.first : '')
  );
  var second = toNumber_(
    (problem && (problem.b ?? problem.second ?? problem.value2 ?? problem.secondValue ?? problem.num2 ??
    problem.y ?? problem.right ?? problem.rhs ?? problem.rightValue ??
    problem.subtrahend ?? problem.divisor ?? problem.next)) ??
    (parsedFromExpression ? parsedFromExpression.second : '')
  );
  var answer = toNumber_(
    (problem && (problem.answer ?? problem.result ?? problem.solution ?? problem.c ?? problem.outcome)) ??
    (parsedFromExpression ? parsedFromExpression.answer : '')
  );

  // Fallbacks: try operands array or nested question object if first/second/answer are still empty
  if (first === '' || second === '' || answer === '') {
    var ops = problem && (problem.operands || problem.args || problem.values);
    if (Array.isArray(ops) && ops.length >= 2) {
      if (first === '') first = toNumber_(ops[0]);
      if (second === '') second = toNumber_(ops[1]);
    }
  }
  if (first === '' || second === '' || answer === '') {
    var qObj = problem && problem.question;
    if (qObj && typeof qObj === 'object') {
      if (first === '') first = toNumber_(qObj.first ?? qObj.a ?? qObj.left ?? qObj.lhs ?? qObj.value1 ?? qObj.num1);
      if (second === '') second = toNumber_(qObj.second ?? qObj.b ?? qObj.right ?? qObj.rhs ?? qObj.value2 ?? qObj.num2);
      if (answer === '') answer = toNumber_(qObj.answer ?? qObj.c ?? qObj.result ?? qObj.solution);
      if (!operation) operation = normalizeOperationSymbol_(qObj.op ?? qObj.operator ?? qObj.symbol ?? qObj.sign);
    }
  }

  // If operation not specified, try to infer from provided numbers
  if (!operation) {
    if (isFiniteNumber_(first) && isFiniteNumber_(second) && isFiniteNumber_(answer)) {
      if (first + second === answer) {
        operation = 'add';
      } else if (first * second === answer) {
        operation = 'mul';
      } else if (first - second === answer) {
        operation = 'sub';
      } else if (second !== 0 && first / second === answer) {
        operation = 'div';
      }
    }
  }
  if (!operation) operation = 'add';

  var a = null, b = null, c = null;
  if (operation === 'add' || operation === 'mul') {
    // For addition/multiplication: first value is a, second is b, derived answer is c
    a = first;
    b = second;
    if (operation === 'add') {
      c = isFiniteNumber_(a) && isFiniteNumber_(b) ? (a + b) : '';
    } else {
      c = isFiniteNumber_(a) && isFiniteNumber_(b) ? (a * b) : '';
    }
  } else if (operation === 'sub' || operation === 'div') {
    // For subtraction/division: first value is c, second value is a, derived answer is b
    a = second;
    c = first;
    if (isFiniteNumber_(c) && isFiniteNumber_(a)) {
      if (operation === 'sub') {
        b = c - a;
      } else {
        b = a === 0 ? '' : (c / a);
      }
    } else {
      b = isFiniteNumber_(answer) ? answer : '';
    }
  } else {
    // Unknown operation, best-effort mapping: follow addition-style mapping
    a = first;
    b = second;
    c = isFiniteNumber_(a) && isFiniteNumber_(b) ? (a + b) : '';
    operation = 'add';
  }

  return {
    operation: operation,
    a: isFiniteNumber_(a) ? a : '',
    b: isFiniteNumber_(b) ? b : '',
    c: isFiniteNumber_(c) ? c : ''
  };
}

// Best-effort extractor to handle strings, arrays, or text-bearing objects
function extractFromProblemGuess_(rawProblem) {
  // If already a well-formed object with numeric-like fields, skip heavy parsing
  if (rawProblem && typeof rawProblem === 'object' && !Array.isArray(rawProblem)) {
    var hasDirectFields = (rawProblem.a !== undefined || rawProblem.first !== undefined || rawProblem.value1 !== undefined ||
      rawProblem.b !== undefined || rawProblem.second !== undefined || rawProblem.value2 !== undefined ||
      rawProblem.answer !== undefined || rawProblem.result !== undefined || rawProblem.solution !== undefined || rawProblem.c !== undefined);
    // Only skip parsing if numeric-like fields are present. The presence of an operation field
    // alone should not prevent us from attempting to parse an expression from text.
    if (hasDirectFields) {
      return null; // let normalizeProblem_ read fields directly
    }
  }

  // Try to obtain an expression string from various shapes
  var exprCandidate = null;
  if (typeof rawProblem === 'string' || typeof rawProblem === 'number') {
    exprCandidate = String(rawProblem);
  } else if (Array.isArray(rawProblem)) {
    try {
      exprCandidate = rawProblem.join(' ');
    } catch (e) {
      exprCandidate = null;
    }
  } else if (rawProblem && typeof rawProblem === 'object') {
    exprCandidate = rawProblem.expr || rawProblem.expression || rawProblem.question || rawProblem.text || rawProblem.q || null;
    // If there is a tokens-like array, attempt to build an expression from it
    if (!exprCandidate) {
      var tokens = rawProblem.tokens || rawProblem.parts || rawProblem.words || null;
      if (Array.isArray(tokens)) {
        try {
          exprCandidate = tokens.join(' ');
        } catch (e2) {
          exprCandidate = null;
        }
      }
    }
    // If there is an operands + operator shape, construct a parsed object directly
    if (!exprCandidate) {
      var opsArr = rawProblem.operands || rawProblem.args || rawProblem.values || null;
      var opSym = rawProblem.operator || rawProblem.op || rawProblem.symbol || rawProblem.sign || null;
      if (Array.isArray(opsArr) && opsArr.length >= 2 && opSym) {
        var firstVal = toNumber_(opsArr[0]);
        var secondVal = toNumber_(opsArr[1]);
        var normOp = normalizeOperationSymbol_(opSym);
        if (isFiniteNumber_(firstVal) && isFiniteNumber_(secondVal)) {
          return { operation: normOp, first: firstVal, second: secondVal, answer: '' };
        }
      }
    }
    // If there is a nested question object with fields, use those
    if (!exprCandidate && rawProblem.question && typeof rawProblem.question === 'object') {
      var q = rawProblem.question;
      var qFirst = toNumber_(q.first ?? q.a ?? q.left ?? q.lhs ?? q.value1 ?? q.num1);
      var qSecond = toNumber_(q.second ?? q.b ?? q.right ?? q.rhs ?? q.value2 ?? q.num2);
      var qAnswer = toNumber_(q.answer ?? q.c ?? q.result ?? q.solution);
      var qOp = normalizeOperationSymbol_(q.op ?? q.operator ?? q.symbol ?? q.sign);
      if (isFiniteNumber_(qFirst) && isFiniteNumber_(qSecond)) {
        return { operation: qOp || '', first: qFirst, second: qSecond, answer: qAnswer };
      }
    }
  }

  if (!exprCandidate) return null;
  var parsed = parseExpression_(exprCandidate);
  return parsed;
}

function parseExpression_(rawExpr) {
  var s = String(rawExpr || '').trim();
  if (!s) return null;

  // Normalize unicode and tokens
  var normalized = s
    .replace(/[×xX]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  // Patterns like: a op b = c  OR  a op b
  var m1 = normalized.match(/^(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)(?:\s*=\s*(-?\d+(?:\.\d+)?))?$/);
  if (m1) {
    var first = Number(m1[1]);
    var op = m1[2];
    var second = Number(m1[3]);
    var ans = m1[4] !== undefined ? Number(m1[4]) : '';
    return { operation: normalizeOperationSymbol_(op), first: first, second: second, answer: ans };
  }

  // Pattern like: c = a op b
  var m2 = normalized.match(/^(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)$/);
  if (m2) {
    var cVal = Number(m2[1]);
    var aVal = Number(m2[2]);
    var op2 = m2[3];
    var bVal = Number(m2[4]);
    // Map to first/second/answer: for sub/div we expect first=c, second=a
    return { operation: normalizeOperationSymbol_(op2), first: aVal, second: bVal, answer: cVal };
  }

  // Words: plus | minus | times | divided by
  var wordy = normalized.toLowerCase();
  var wordMatch = wordy.match(/^(-?\d+(?:\.\d+)?)\s*(plus|minus|times|multiplied by|divided by)\s*(-?\d+(?:\.\d+)?)(?:\s*=\s*(-?\d+(?:\.\d+)?))?$/);
  if (wordMatch) {
    var aNum = Number(wordMatch[1]);
    var opWord = wordMatch[2];
    var bNum = Number(wordMatch[3]);
    var ansWord = wordMatch[4] !== undefined ? Number(wordMatch[4]) : '';
    var opNorm = (function(w){
      if (w === 'plus') return 'add';
      if (w === 'minus') return 'sub';
      if (w === 'times' || w === 'multiplied by') return 'mul';
      if (w === 'divided by') return 'div';
      return '';
    })(opWord);
    return { operation: opNorm, first: aNum, second: bNum, answer: ansWord };
  }

  return null;
}

function normalizeOperationSymbol_(raw) {
  var s = String(raw || '').toLowerCase().trim();
  if (s === '+' || s === 'add' || s === 'addition') return 'add';
  if (s === '-' || s === 'sub' || s === 'subtract' || s === 'subtraction') return 'sub';
  if (s === '*' || s === 'x' || s === '×' || s === 'mul' || s === 'multiply' || s === 'multiplication') return 'mul';
  if (s === '/' || s === '÷' || s === 'div' || s === 'divide' || s === 'division') return 'div';
  return s;
}

function toNumber_(value) {
  if (value === null || value === undefined || value === '') return '';
  var n = Number(value);
  return isNaN(n) ? '' : n;
}

function isFiniteNumber_(value) {
  return typeof value === 'number' && isFinite(value);
}

function onEdit(e) {
  var sheet = e && e.range && e.range.getSheet ? e.range.getSheet() : null;
  if (!sheet) return;
  if (sheet.getName() !== 'Sessions') return;
  ensureSessionsHeaders_(sheet);
  ensureScore120Formulas_(sheet);
}
