/**
 * Stream State Manager
 * Handles state transitions for upload streams to prevent race conditions
 */

// Stream states
const STATES = {
  INITIAL: 'initial',    // Stream created but not started
  ACTIVE: 'active',      // Stream is active and transferring data
  PAUSED: 'paused',      // Stream temporarily paused (e.g., due to backpressure)
  ABORTED: 'aborted',    // Stream was aborted before completion
  COMPLETED: 'completed',// Stream successfully completed
  ERROR: 'error'         // Stream encountered an error
};

/**
 * Valid state transitions
 * From state -> Array of valid states to transition to
 */
const VALID_TRANSITIONS = {
  [STATES.INITIAL]: [STATES.ACTIVE, STATES.ABORTED, STATES.ERROR],
  [STATES.ACTIVE]: [STATES.PAUSED, STATES.COMPLETED, STATES.ABORTED, STATES.ERROR],
  [STATES.PAUSED]: [STATES.ACTIVE, STATES.ABORTED, STATES.ERROR],
  [STATES.ABORTED]: [], // Terminal state
  [STATES.COMPLETED]: [], // Terminal state
  [STATES.ERROR]: [] // Terminal state
};

/**
 * Stream State Manager class
 * Manages state transitions and prevents race conditions
 */
class StreamState {
  /**
   * Create a stream state manager
   * @param {string} streamId Identifier for the stream
   * @param {Function} onStateChange Optional callback for state changes
   */
  constructor(streamId, onStateChange = null) {
    this.streamId = streamId;
    this.state = STATES.INITIAL;
    this.error = null;
    this.stateChangeCallback = onStateChange;
    this.transitions = [];
    this.isTerminal = false;
    
    // Log initial state
    this.logTransition(null, this.state);
  }
  
  /**
   * Get current state
   * @returns {string} Current state
   */
  getState() {
    return this.state;
  }
  
  /**
   * Check if current state matches given state
   * @param {string} state State to check
   * @returns {boolean} Whether current state matches
   */
  is(state) {
    return this.state === state;
  }
  
  /**
   * Check if the stream is in a terminal state
   * @returns {boolean} Whether in terminal state
   */
  isInTerminalState() {
    return this.isTerminal;
  }
  
  /**
   * Attempt to transition to a new state
   * @param {string} newState New state to transition to
   * @param {Error} error Optional error object if transitioning to ERROR state
   * @returns {boolean} Whether transition succeeded
   */
  transition(newState, error = null) {
    // Check if already in terminal state
    if (this.isTerminal) {
      console.log(`Stream ${this.streamId} - Cannot transition from terminal state ${this.state} to ${newState}`);
      return false;
    }
    
    // Ensure valid state parameter
    if (!Object.values(STATES).includes(newState)) {
      console.error(`Stream ${this.streamId} - Invalid state: ${newState}`);
      return false;
    }
    
    // Check if transition is valid
    // eslint-disable-next-line security/detect-object-injection
    if (!VALID_TRANSITIONS[this.state]?.includes(newState)) {
      console.error(`Stream ${this.streamId} - Invalid transition: ${this.state} -> ${newState}`);
      return false;
    }
    
    // Log and execute transition
    const oldState = this.state;
    this.state = newState;
    
    // Store error if provided
    if (error && (newState === STATES.ERROR || newState === STATES.ABORTED)) {
      this.error = error;
    }
    
    // Check if new state is terminal
    this.isTerminal = newState === STATES.COMPLETED || 
                      newState === STATES.ABORTED || 
                      newState === STATES.ERROR;
    
    // Log transition
    this.logTransition(oldState, newState);
    
    // Call state change callback if provided
    if (typeof this.stateChangeCallback === 'function') {
      this.stateChangeCallback(oldState, newState, error);
    }
    
    return true;
  }
  
  /**
   * Attempt to transition to active state
   * @returns {boolean} Whether transition succeeded
   */
  activate() {
    return this.transition(STATES.ACTIVE);
  }
  
  /**
   * Attempt to transition to paused state
   * @returns {boolean} Whether transition succeeded
   */
  pause() {
    return this.transition(STATES.PAUSED);
  }
  
  /**
   * Attempt to transition to completed state
   * @returns {boolean} Whether transition succeeded
   */
  complete() {
    return this.transition(STATES.COMPLETED);
  }
  
  /**
   * Attempt to transition to aborted state
   * @param {Error} error Optional error object
   * @returns {boolean} Whether transition succeeded
   */
  abort(error = null) {
    return this.transition(STATES.ABORTED, error);
  }
  
  /**
   * Attempt to transition to error state
   * @param {Error} error Error object
   * @returns {boolean} Whether transition succeeded
   */
  fail(error) {
    return this.transition(STATES.ERROR, error);
  }
  
  /**
   * Log state transition
   * @param {string} oldState Previous state
   * @param {string} newState New state
   */
  logTransition(oldState, newState) {
    const transition = {
      from: oldState,
      to: newState,
      timestamp: new Date().toISOString()
    };
    
    this.transitions.push(transition);
    
    if (oldState) {
      console.log(`Stream ${this.streamId} - State transition: ${oldState} -> ${newState}`);
    } else {
      console.log(`Stream ${this.streamId} - Initial state: ${newState}`);
    }
  }
  
  /**
   * Get error if in error or aborted state
   * @returns {Error|null} Error object or null
   */
  getError() {
    return this.error;
  }
  
  /**
   * Get transition history
   * @returns {Array} Array of transitions
   */
  getTransitions() {
    return [...this.transitions];
  }
}

// Export states and StreamState class
module.exports = {
  STATES,
  StreamState
};