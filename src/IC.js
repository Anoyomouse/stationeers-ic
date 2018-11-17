const BranchInstructions = require("./instructions/Branch");
const SelectInstructions = require("./instructions/Select");

"use strict";

const NEWLINE = "\n";
const INSTRUCTION_SEPERATOR = /\s+/;
const COMMENT_SEPERATOR = /\s*(\/\/|#)/;

const IO_REGISTER_COUNT = 6;
const INTERNAL_REGISTER_COUNT = 18;

const STACK_SIZE = 512;
const STACK_POINTER_REGISTER = 16;

const RETURN_ADDRESS_REGISTER = 17;

const INITIAL_ALIASES = ["db", "sp", "ra"];

module.exports = class IC {
  constructor() {
    this._opcodes = {};
    this._instructions = [];

    this._ignoreErrors = false;

    this._validProgram = true;
    this._programErrors = [];
    this._programErrorLines = [];

    this._programCounter = 0;

    this._aliases = {};
    this._aliasesAsigned = [];

    this._jumpTags = {};

    this._ioRegister = [];
    this._ioSlot = [];
    this._ioReagent = [];
    this._ioRegisterConnected = [];

    for (var i = 0; i <= IO_REGISTER_COUNT; i++) {
      this._ioRegister[i] = {};
      this._ioSlot[i] = {};
      this._ioReagent[i] = {};
      this._ioRegisterConnected[i] = true;
    }

    this._internalRegister = Array(INTERNAL_REGISTER_COUNT).fill(0);

    this._stack = Array(STACK_SIZE).fill(0);

    BranchInstructions(this);
    SelectInstructions(this);

    this._registerOpcode("move", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_move);
    this._registerOpcode("add", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_add);
    this._registerOpcode("sub", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_sub);
    this._registerOpcode("mul", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_mul);
    this._registerOpcode("div", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_div);
    this._registerOpcode("mod", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_mod);

    this._registerOpcode("sqrt", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_sqrt);
    this._registerOpcode("round", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_round);
    this._registerOpcode("trunc", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_trunc);
    this._registerOpcode("ceil", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_ceil);
    this._registerOpcode("floor", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_floor);
    this._registerOpcode("max", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_max);
    this._registerOpcode("min", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_min);
    this._registerOpcode("abs", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_abs);
    this._registerOpcode("log", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_log);
    this._registerOpcode("exp", [["r", "a"], ["r", "i", "f", "a"]], this._instruction_exp);
    this._registerOpcode("rand", [["r", "a"]], this._instruction_rand);
    this._registerOpcode("and", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_and);
    this._registerOpcode("or", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_or);
    this._registerOpcode("xor", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_xor);
    this._registerOpcode("nor", [["r", "a"], ["r", "i", "f", "a"], ["r", "i", "f", "a"]], this._instruction_nor);

    this._registerOpcode("yield", [], this._instruction_yield);

    this._registerOpcode("l", [["r", "a"], ["d", "a"], ["s"]], this._instruction_l);
    this._registerOpcode("s", [["d", "a"], ["s"], ["r", "i", "f", "a"]], this._instruction_s);

    this._registerOpcode("ls", [["r", "a"], ["d", "a"], ["r", "i", "a"], ["s"]], this._instruction_ls);
    this._registerOpcode("lr", [["r", "a"], ["d", "a"], ["s"], ["s"]], this._instruction_lr);

    this._registerOpcode("alias", [["s"], ["r", "d", "a"]], this._instruction_alias);

    this._registerOpcode("push", [["r", "i", "f", "a"]], this._instruction_push);
    this._registerOpcode("pop", [["r", "a"]], this._instruction_pop);
    this._registerOpcode("peek", [["r", "a"]], this._instruction_peek);

    this._registerOpcode("hcf", [], this._instruction_hcf);

    this._instruction_alias(["db", "d" + IO_REGISTER_COUNT]);
    this._instruction_alias(["sp", "r" + STACK_POINTER_REGISTER]);
    this._instruction_alias(["ra", "r" + RETURN_ADDRESS_REGISTER]);
  }

  load(unparsedInstructions) {
    this._instructions = unparsedInstructions.split(NEWLINE);

    this._preProcess();
    this._validate();
  }

  _preProcess() {
    var parsedLines = this._instructions.map((content) => this._parseLine(content));
    var foundAliases = parsedLines.filter((tokens) => tokens.length >= 2 && tokens[0] === "alias").map((tokens) => tokens[1]).concat(INITIAL_ALIASES);
    var currentAliases = this._aliases;

    for (var alias of foundAliases) {
      if (!Object.keys(currentAliases).includes(alias)) {
        this._aliases[alias] = { value: 0 };
      }
    }

    var removedAliases = Object.keys(currentAliases).filter((currentAlias) => !foundAliases.includes(currentAlias));

    for (var toBeRemoved of removedAliases) {
      delete this._aliases[toBeRemoved];

      var foundIndex = this._aliasesAsigned.indexOf(toBeRemoved);
      delete this._aliasesAsigned[foundIndex];
    }

    this._jumpTags = {};

    parsedLines.forEach((content, line) => {
      if (content.length > 0) {
        var matches = content[0].match(/(\S+):/);
        if (matches && !Object.keys(this._jumpTags).includes(matches[1])) {
          this._jumpTags[matches[1]] = line;
        }
      }
    });
  }

  _validate() {
    this._programErrors = [].concat.apply([], (this._instructions.map((content, line) => this._validateLine(content, line)).filter((validatedLine) => validatedLine)));

    var errors = this._programErrors.filter((e) => e["type"] === "error");
    this._validProgram = errors.length == 0;

    this._programErrorLines = errors.map((e) => e["line"]);
  }

  _validateLine(content, line) {
    var errors = [];

    if (content.length > 52) {
      errors.push({ line: line, error: "LINE_TOO_LONG", "type": "warning" });
    }

    if (line >= 128) {
      errors.push({ line: line, error: "PROGRAM_TOO_LONG", "type": "warning" });
    }

    var tokens = this._parseLine(content);

    if (tokens.length < 1) {
      return errors;
    }

    var jumpTagMatch = content.match(/^(\S+):/);

    if (jumpTagMatch) {
      if (this._jumpTags[jumpTagMatch[1]] !== line) {
        errors.push({ line: line, error: "INVALID_JUMP_TAG_DUPLICATE", "type": "error" });
      }

      if (tokens.length > 1) {
        errors.push({ line: line, error: "INVALID_JUMP_TAG_CONTENT_AFTER", "type": "error" });
      }

      return errors;
    }

    var opcode = tokens.shift();

    if (!Object.keys(this._opcodes).includes(opcode)) {
      errors.push({ line: line, error: "UNKNOWN_INSTRUCTION", "type": "error" });
      return errors;
    }

    var opcodeFields = this._opcodes[opcode].fields;

    var fieldErrors = opcodeFields.map((type, i) => {
      if (tokens.length < (i + 1)) {
        return { line: line, error: "MISSING_FIELD", field: i, "type": "error" };
      }

      var typeCheck = this._checkFieldTypes(tokens[i], type);

      if (typeCheck) {
        return { line: line, error: typeCheck, validTypes: type, field: i, "type": "error" };
      }
    }).filter((error) => error);

    if (tokens.length > opcodeFields.length) {
      for (var i = opcodeFields.length; i < tokens.length; i++) {
        fieldErrors.push({ line: line, error: "EXTRA_FIELD", field: i, "type": "error" });
      }
    }

    return errors.concat(fieldErrors);
  }

  _checkFieldTypes(token, fieldTypes) {
    // Jump Label
    if (fieldTypes.includes("j")) {
      if (Object.keys(this._jumpTags).includes(token)) {
        return undefined;
      }
    }

    // Alias
    if (fieldTypes.includes("a")) {
      if (Object.keys(this._aliases).includes(token)) {
        return undefined;
      }
    }

    // Register
    if (fieldTypes.includes("r")) {
      var registerMatches = token.match(/^r+(\d+)$/);

      if (registerMatches) {
        var registerNumber = Number.parseInt(registerMatches[1]);

        if (registerNumber >= INTERNAL_REGISTER_COUNT) {
          return "INVALID_FIELD_NO_SUCH_REGISTER";
        }

        return undefined;
      }
    }

    // Device
    if (fieldTypes.includes("d")) {
      var deviceMatches = token.match(/^d(r*)(\d)+$/);

      if (deviceMatches) {
        var maxRegister = deviceMatches[1].length > 0 ? INTERNAL_REGISTER_COUNT : IO_REGISTER_COUNT;
        var actualRegister = Number.parseInt(deviceMatches[2]);

        if (actualRegister >= maxRegister) {
          return "INVALID_FIELD_NO_SUCH_REGISTER";
        }

        return undefined;
      }
    }

    // Number Handling
    var asNumber = Number.parseFloat(token);

    if (!Number.isNaN(asNumber)) {
      // Float
      if (fieldTypes.includes("f")) {
        return undefined;
      }

      // Integer
      if (fieldTypes.includes("i")) {
        if (asNumber === Number.parseInt(token)) {
          return undefined;
        }
      }
    }

    // String
    if (fieldTypes.includes("s")) {
      return undefined;
    }

    return "INVALID_FIELD_INVALID_TYPE";
  }

  _parseLine(line) {
    var withoutComment = line.split(COMMENT_SEPERATOR)[0];
    return withoutComment.split(INSTRUCTION_SEPERATOR).filter((token) => token.trim());
  }

  setIgnoreErrors(value) {
    this._ignoreErrors = value;
  }

  getProgramErrors() {
    return this._programErrors;
  }

  getInstructionCount() {
    return this._instructions.length;
  }

  getIONames() {
    var names = [];

    for (var i = 0; i < IO_REGISTER_COUNT; i++) {
      names.push(["d"] + i);
    }

    names.push("db");

    return names;
  }

  getIOLabels() {
    var labels = Array(IO_REGISTER_COUNT + 1);

    for (var i = 0; i <= IO_REGISTER_COUNT; i++) {
      labels[i] = [];
    }

    var aliases = Object.keys(this._aliases);

    for (var alias of aliases) {
      if (this._aliasesAsigned.includes(alias) && this._aliases[alias]["type"] === "d") {
        labels[this._aliases[alias]["value"]].push(alias);
      }
    }

    for (i = 0; i <= IO_REGISTER_COUNT; i++) {
      labels[i] = labels[i].join(",");
    }

    return labels;
  }

  getIOConnected() {
    return this._ioRegisterConnected;
  }

  setIOConnected(index, value) {
    this._ioRegisterConnected[index] = value;
  }

  getIORegisters() {
    return this._ioRegister;
  }

  setIORegister(index, field, value) {
    if (index <= IO_REGISTER_COUNT) {
      if (value !== undefined) {
        this._ioRegister[index][field] = value;
      } else {
        delete this._ioRegister[index][field];
      }
    }
  }

  getIOSlots() {
    return this._ioSlot;
  }

  setIOSlot(index, slot, logicType, value) {
    if (index <= IO_REGISTER_COUNT) {
      if (value !== undefined) {
        if (!Object.keys(this._ioSlot[index]).includes(slot.toString())) {
          this._ioSlot[index][slot] = {};
        }

        this._ioSlot[index][slot][logicType] = value;
      } else {
        delete this._ioSlot[index][slot][logicType];

        if (Object.keys(this._ioSlot[index][slot]).length === 0) {
          delete this._ioSlot[index][slot];
        }
      }
    }
  }

  getIOReagents() {
    return this._ioReagent;
  }

  setIOReagent(index, reagent, logicReagentMode, value) {
    if (index <= IO_REGISTER_COUNT) {
      if (value !== undefined) {
        if (!Object.keys(this._ioReagent[index]).includes(reagent)) {
          this._ioReagent[index][reagent] = {};
        }

        this._ioReagent[index][reagent][logicReagentMode] = value;
      } else {
        delete this._ioReagent[index][reagent][logicReagentMode];

        if (Object.keys(this._ioReagent[index][reagent]).length === 0) {
          delete this._ioReagent[index][reagent];
        }
      }
    }    
  }

  getStack() {
    return this._stack;
  }

  getInternalRegisters() {
    return this._internalRegister;
  }

  getInternalLabels() {
    var labels = Array(INTERNAL_REGISTER_COUNT);

    for (var i = 0; i < INTERNAL_REGISTER_COUNT; i++) {
      labels[i] = [];
    }

    var aliases = Object.keys(this._aliases);

    for (var alias of aliases) {
      if (this._aliasesAsigned.includes(alias) && this._aliases[alias]["type"] === "r") {
        labels[this._aliases[alias]["value"]].push(alias);
      }
    }

    for (i = 0; i < INTERNAL_REGISTER_COUNT; i++) {
      labels[i] = labels[i].join(",");
    }

    return labels;
  }

  setInternalRegister(index, value) {
    if (index < INTERNAL_REGISTER_COUNT) {
      this._internalRegister[index] = value;
    }
  }

  programCounter() {
    return this._programCounter;
  }

  isValidProgram() {
    return this._validProgram;
  }

  _resolveDeviceNumber(register, allowedTypes) {
    if (allowedTypes.includes("a")) {
      var foundAlias = this._aliases[register];

      if (foundAlias) {
        if (!allowedTypes.includes(foundAlias.type)) {
          throw "ALIAS_TYPE_MISMATCH";
        } else {
          register = foundAlias.type + foundAlias.value;
        }
      }
    }

    if (register.charAt(0) === "d") {
      var number = 0;
      var match = register.match(/d(r*)(\d+)/);

      if (match) {
        if (match[1].length > 0) {
          number = this._getRegister(match[1] + match[2], undefined, ["r"]);
        } else {
          number = Number.parseInt(match[2]);
        }
      }

      if (number > IO_REGISTER_COUNT) {
        throw "INVALID_REGISTER_LOCATION";      
      } 
      
      return number;
    }

    throw undefined;      
  }

  _isDeviceConnected(register, allowedTypes) {
    var deviceNumber = this._resolveDeviceNumber(register, allowedTypes);

    if (deviceNumber === undefined) {
      return false;
    } else {
      return this._ioRegisterConnected[deviceNumber];
    }
  }

  _setRegister(register, value, field, allowedTypes) {
    if (allowedTypes.includes("a")) {
      var foundAlias = this._aliases[register];

      if (foundAlias) {
        if (!allowedTypes.includes(foundAlias.type)) {
          throw "ALIAS_TYPE_MISMATCH";
        } else {
          register = foundAlias.type + foundAlias.value;
        }
      }
    }

    let type = register.charAt(0);
    var number;

    switch (type) {
    case "d":
      var match = register.match(/d(r*)(\d+)/);

      if (match) {
        if (match[1].length > 0) {
          number = this._getRegister(match[1] + match[2], undefined, ["r"]);
        } else {
          number = Number.parseInt(match[2]);
        }
      }

      if (number > IO_REGISTER_COUNT) {
        throw "INVALID_REGISTER_LOCATION";
      }

      if (!this._ioRegisterConnected[number]) {
        throw "INTERACTION_WITH_DISCONNECTED_DEVICE";
      }

      return this.setIORegister(number, field, value);
    case "r":
      number = this._resolveIndirectRegister(register);

      if (number !== null) {
        return this.setInternalRegister(number, value);
      }
    }
  }

  _getRegister(register, field, allowedTypes) {
    if (allowedTypes.includes("a")) {
      var foundAlias = this._aliases[register];

      if (foundAlias) {
        if (!allowedTypes.includes(foundAlias.type)) {
          throw "ALIAS_TYPE_MISMATCH";
        } else {
          register = foundAlias.type + foundAlias.value;
        }
      }
    }

    let type = register.charAt(0);
    var number;

    switch (type) {
    case "d":
      var match = register.match(/d(r*)(\d+)/);

      if (match) {
        if (match[1].length > 0) {
          number = this._getRegister(match[1] + match[2], undefined, ["r"]);
        } else {
          number = Number.parseInt(match[2]);
        }
      }

      if (number > IO_REGISTER_COUNT) {
        throw "INVALID_REGISTER_LOCATION";
      }

      if (!this._ioRegisterConnected[number]) {
        throw "INTERACTION_WITH_DISCONNECTED_DEVICE";
      }

      if (!this.getIORegisters()[number][field]) {
        this.setIORegister(number, field, 0);
      }

      return this.getIORegisters()[number][field];

    case "r":
      number = this._resolveIndirectRegister(register);

      if (number !== null) {
        return this.getInternalRegisters()[number];
      }
    }

    var value = Number.parseFloat(register);

    if (Number.isNaN(value)) {
      if (allowedTypes && Object.keys(this._jumpTags).includes(register)) {
        return this._jumpTags[register];
      }

      return;
    } else {
      return value;
    }
  }

  _resolveIndirectRegister(register) {
    var matched = register.match(/(r+)(\d+)/);

    if (matched === null) {
      return null;
    }

    var registerIndirectionCount = matched[1].length - 1;
    var number = Number.parseInt(matched[2]);

    for (var i = 0; i < registerIndirectionCount; i++) {
      number = this.getInternalRegisters()[number];

      if (number >= INTERNAL_REGISTER_COUNT) {
        throw "INVALID_REGISTER_LOCATION";
      }
    }

    return number;
  }

  step() {
    if (this._validProgram || this._ignoreErrors) {
      var instruction = this._instructions[this._programCounter];
      var isErrorLine = this._programErrorLines.includes(this._programCounter);

      this._programCounter++;

      if (!isErrorLine) {
        try {
          this._executeInstruction(instruction);
        } catch (err) {
          return err;
        }
      }

      if (this._programCounter >= this.getInstructionCount()) {
        return "END_OF_PROGRAM";
      } else if (this._programCounter < 0) {
        return "INVALID_PROGRAM_COUNTER";
      }
    } else {
      return "INVALID_PROGRAM";
    }
  }

  restart() {
    this._programCounter = 0;
    this._internalRegister = Array(INTERNAL_REGISTER_COUNT).fill(0);
    this._stack = Array(STACK_SIZE).fill(0);
  }

  _executeInstruction(instruction) {
    var fields = this._parseLine(instruction);
    var opcode = fields.shift();

    var opcodeData = this._opcodes[opcode];

    if (opcodeData) {
      opcodeData.func(fields, opcodeData.fields, this);
    }

    return opcode;
  }

  _registerOpcode(name, fields, func) {
    func = func.bind(this);
    this._opcodes[name] = { fields, func };
  }

  _instruction_move(fields, allowedTypes) {
    let outputValue = this._getRegister(fields[1], undefined, allowedTypes[1]);
    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_add(fields, allowedTypes) {
    let outputValue = this._getRegister(fields[1], undefined, allowedTypes[1]) + this._getRegister(fields[2], undefined, allowedTypes[2]);
    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_sub(fields, allowedTypes) {
    let outputValue = this._getRegister(fields[1], undefined, allowedTypes[1]) - this._getRegister(fields[2], undefined, allowedTypes[2]);
    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_mul(fields, allowedTypes) {
    let outputValue = this._getRegister(fields[1], undefined, allowedTypes[1]) * this._getRegister(fields[2], undefined, allowedTypes[2]);
    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_div(fields, allowedTypes) {
    let outputValue = this._getRegister(fields[1], undefined, allowedTypes[1]) / this._getRegister(fields[2], undefined, allowedTypes[2]);
    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_mod(fields, allowedTypes) {
    let valueOne = this._getRegister(fields[1], undefined, allowedTypes[1]);
    let valueTwo = this._getRegister(fields[2], undefined, allowedTypes[2]);

    let outputValue = valueOne % valueTwo;
    if (outputValue < 0) {
      outputValue += valueTwo;
    }

    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_sqrt(fields, allowedTypes) {
    this._setRegister(fields[0], Math.sqrt(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_round(fields, allowedTypes) {
    this._setRegister(fields[0], Math.round(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_trunc(fields, allowedTypes) {
    this._setRegister(fields[0], Math.trunc(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_ceil(fields, allowedTypes) {
    this._setRegister(fields[0], Math.ceil(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_floor(fields, allowedTypes) {
    this._setRegister(fields[0], Math.floor(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_max(fields, allowedTypes) {
    let outputValue = Math.max(this._getRegister(fields[1], undefined, allowedTypes[1]), this._getRegister(fields[2], undefined, allowedTypes[2]));
    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_min(fields, allowedTypes) {
    let outputValue = Math.min(this._getRegister(fields[1], undefined, allowedTypes[1]), this._getRegister(fields[2], undefined, allowedTypes[2]));
    this._setRegister(fields[0], outputValue, undefined, allowedTypes[0]);
  }

  _instruction_abs(fields, allowedTypes) {
    this._setRegister(fields[0], Math.abs(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_log(fields, allowedTypes) {
    this._setRegister(fields[0], Math.log(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_exp(fields, allowedTypes) {
    this._setRegister(fields[0], Math.exp(this._getRegister(fields[1], undefined, allowedTypes[1])), undefined, allowedTypes[0]);
  }

  _instruction_rand(fields, allowedTypes) {
    this._setRegister(fields[0], Math.random(), undefined, allowedTypes[0]);
  }

  _instruction_and(fields, allowedTypes) {
    var valueOne = this._getRegister(fields[1], undefined, allowedTypes[1]) != 0;
    var valueTwo = this._getRegister(fields[2], undefined, allowedTypes[2]) != 0;
    var result = (valueOne && valueTwo ? 1 : 0);
    this._setRegister(fields[0], result, undefined, allowedTypes[0]);
  }

  _instruction_or(fields, allowedTypes) {
    var valueOne = this._getRegister(fields[1], undefined, allowedTypes[1]) != 0;
    var valueTwo = this._getRegister(fields[2], undefined, allowedTypes[2]) != 0;
    var result = (valueOne || valueTwo ? 1 : 0);
    this._setRegister(fields[0], result, undefined, allowedTypes[0]);
  }

  _instruction_xor(fields, allowedTypes) {
    var valueOne = this._getRegister(fields[1], undefined, allowedTypes[1]) != 0;
    var valueTwo = this._getRegister(fields[2], undefined, allowedTypes[2]) != 0;
    var result = (valueOne ^ valueTwo ? 1 : 0);
    this._setRegister(fields[0], result, undefined, allowedTypes[0]);
  }

  _instruction_nor(fields, allowedTypes) {
    var valueOne = this._getRegister(fields[1], undefined, allowedTypes[1]) != 0;
    var valueTwo = this._getRegister(fields[2], undefined, allowedTypes[2]) != 0;
    var result = (!valueOne && !valueTwo) ? 1 : 0;
    this._setRegister(fields[0], result, undefined, allowedTypes[0]);
  }

  _jumper(condition, destination, relative, and_link) {
    if (condition) {
      if (and_link) {
        this._internalRegister[RETURN_ADDRESS_REGISTER] = this._programCounter;
      }

      if (relative) {
        // -1 is required becaused we increment the the PC before we execute the instruction.
        this._programCounter += Math.round(destination) - 1;
      } else {
        this._programCounter = Math.round(destination);
      }      
    }
  }

  _instruction_yield() {
    throw "YIELD";
  }

  _instruction_hcf() {
    throw "HALT_AND_CATCH_FIRE";
  }

  _instruction_l(fields, allowedTypes) {
    this._setRegister(fields[0], this._getRegister(fields[1], fields[2], allowedTypes[1]), undefined, allowedTypes[0]);
  }

  _instruction_s(fields, allowedTypes) {
    this._setRegister(fields[0], this._getRegister(fields[2], undefined, allowedTypes[2]), fields[1], allowedTypes[0]);
  }

  _instruction_ls(fields, allowedTypes) {
    var deviceNumber = this._resolveDeviceNumber(fields[1], allowedTypes[1]); 
    var slotNumber = Number(this._getRegister(fields[2], undefined, allowedTypes[2])).toString();

    if (!Object.keys(this._ioSlot[deviceNumber]).includes(slotNumber.toString()) || !Object.keys(this._ioSlot[deviceNumber][slotNumber]).includes(fields[3])) {
      this.setIOSlot(deviceNumber, slotNumber, fields[3], 0);
    }

    var value = this._ioSlot[deviceNumber][slotNumber][fields[3]];
    this._setRegister(fields[0], value, undefined, allowedTypes[0]);
  }

  _instruction_lr(fields, allowedTypes) {
    var deviceNumber = this._resolveDeviceNumber(fields[1], allowedTypes[1]); 

    if (!Object.keys(this._ioReagent[deviceNumber]).includes(fields[3]) || !Object.keys(this._ioReagent[deviceNumber][fields[3]]).includes(fields[2])) {
      this.setIOReagent(deviceNumber, fields[3], fields[2], 0);
    }

    var value = this._ioReagent[deviceNumber][fields[3]][fields[2]];
    this._setRegister(fields[0], value, undefined, allowedTypes[0]); 
  }

  _instruction_alias(fields) {
    var matches = fields[1].match(/^([dr])(\d+)$/);

    if (matches) {
      var number = Number.parseInt(matches[2]);
      this._aliases[fields[0]] = { value: number, type: matches[1] };
      this._aliasesAsigned.push(fields[0]);
    } else {
      var foundAlias = this._aliases[fields[1]];
      
      if (foundAlias) {
        this._aliases[fields[0]] = { value: foundAlias.value, type: foundAlias.type };
        this._aliasesAsigned.push(fields[0]);
      }
    }
  }

  _instruction_push(fields, allowedTypes) {
    var stackPosition = this._internalRegister[STACK_POINTER_REGISTER];

    if (stackPosition >= STACK_SIZE) {
      throw "STACK_OVERFLOW";
    }

    this._stack[stackPosition] = this._getRegister(fields[0], undefined, allowedTypes[0]);
    this._internalRegister[STACK_POINTER_REGISTER] = stackPosition + 1;
  }

  _instruction_pop(fields, allowedTypes) {
    var stackPosition = this._internalRegister[STACK_POINTER_REGISTER];

    if (stackPosition <= 0) {
      throw "STACK_UNDERFLOW";
    }

    stackPosition -= 1;
    this._internalRegister[STACK_POINTER_REGISTER] = stackPosition;
    this._setRegister(fields[0], this._stack[stackPosition], undefined, allowedTypes[0]);
  }

  _instruction_peek(fields, allowedTypes) {
    var stackPosition = this._internalRegister[STACK_POINTER_REGISTER];

    if (stackPosition <= 0) {
      throw "STACK_UNDERFLOW";
    }

    this._setRegister(fields[0], this._stack[stackPosition - 1], undefined, allowedTypes[0]);
  }
};
