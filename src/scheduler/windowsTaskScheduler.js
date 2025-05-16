/**
 * Windows Task Scheduler module for Vena ETL Tool
 * Handles creation of scheduled tasks for automation
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { config } = require('../config');
const { sanitizeId } = require('../utils/fileHandling');

// Use the centralized scheduler configuration from config.js
const schedulerConfig = config.scheduler;

/**
 * Validate schedule parameters
 * @param {string} minute Minute (0-59)
 * @param {string} hour Hour (0-23)
 * @param {string} day Day of month (1-31)
 * @param {string} month Month (1-12)
 * @param {string} dayOfWeek Day of week (0-6, 0=Sunday)
 * @returns {Object} Validation result with success flag and optional error
 */
function validateSchedule(minute, hour, day, month, dayOfWeek) {
  const result = { success: true, warnings: [] };

  // Check minute
  if (minute !== '*' && (isNaN(parseInt(minute)) || parseInt(minute) < 0 || parseInt(minute) > 59)) {
    result.success = false;
    result.error = `Invalid minute value: ${minute}. Must be between 0-59 or *`;
    return result;
  }

  // Check hour
  if (hour !== '*' && (isNaN(parseInt(hour)) || parseInt(hour) < 0 || parseInt(hour) > 23)) {
    result.success = false;
    result.error = `Invalid hour value: ${hour}. Must be between 0-23 or *`;
    return result;
  }

  // Check day
  if (day !== '*' && (isNaN(parseInt(day)) || parseInt(day) < 1 || parseInt(day) > 31)) {
    result.success = false;
    result.error = `Invalid day value: ${day}. Must be between 1-31 or *`;
    return result;
  }

  // Check month
  if (month !== '*' && (isNaN(parseInt(month)) || parseInt(month) < 1 || parseInt(month) > 12)) {
    result.success = false;
    result.error = `Invalid month value: ${month}. Must be between 1-12 or *`;
    return result;
  }

  // Check day of week
  if (dayOfWeek !== '*') {
    const days = dayOfWeek.split(',');
    for (const d of days) {
      if (isNaN(parseInt(d)) || parseInt(d) < 0 || parseInt(d) > 6) {
        result.success = false;
        result.error = `Invalid day of week value: ${dayOfWeek}. Must be between 0-6 (0=Sunday) or *`;
        return result;
      }
    }
  }

  // Add warnings for potentially problematic combinations
  if (day !== '*' && dayOfWeek !== '*') {
    result.warnings.push('Both day of month and day of week are specified, which may lead to unexpected scheduling.');
  }

  return result;
}

/**
 * Check if a scheduled task exists
 * @param {string} taskName Name of the task to check
 * @returns {Promise<boolean>} True if task exists
 */
async function checkTaskExists(taskName) {
  // Sanitize the task name to prevent command injection
  const sanitizedTaskName = sanitizeId(taskName);
  
  if (sanitizedTaskName !== taskName) {
    console.warn('Warning: Task name contained potentially unsafe characters and was sanitized.');
  }
  
  return new Promise((resolve) => {
    // Security note: This exec call is safe because taskName comes from configuration
    // and is sanitized to prevent command injection
    // eslint-disable-next-line security/detect-child-process
    exec(`schtasks /query /tn "${sanitizedTaskName}" /fo list`, (error) => {
      resolve(!error); // Task exists if no error
    });
  });
}

/**
 * Delete a scheduled task
 * @param {string} taskName Name of the task to delete
 * @returns {Promise<string>} Command output
 */
async function deleteTask(taskName) {
  // Sanitize the task name to prevent command injection
  const sanitizedTaskName = sanitizeId(taskName);
  
  if (sanitizedTaskName !== taskName) {
    console.warn('Warning: Task name contained potentially unsafe characters and was sanitized.');
  }
  
  return new Promise((resolve, reject) => {
    // Security note: This exec call is safe because taskName comes from configuration
    // and is sanitized to prevent command injection
    // eslint-disable-next-line security/detect-child-process
    exec(`schtasks /delete /tn "${sanitizedTaskName}" /f`, (error, stdout) => {
      if (error) reject(new Error(`Failed to delete task: ${error.message}`));
      else resolve(stdout);
    });
  });
}

/**
 * Create a Windows scheduled task based on .env settings
 * @returns {Promise<boolean>} Success status
 */
async function createScheduledTask() {
  try {
    console.log('\n=== Creating Windows Scheduled Task ===\n');
    
    // Get schedule config
    const taskName = schedulerConfig.taskName;
    const { minute, hour, day, month, dayOfWeek } = schedulerConfig.schedule;
    const { timeLimit } = schedulerConfig;
    
    // Sanitize the task name to prevent command injection
    const sanitizedTaskName = sanitizeId(taskName);
    
    if (sanitizedTaskName !== taskName) {
      console.warn('Warning: Task name contained potentially unsafe characters and was sanitized.');
    }
    
    // Validate schedule parameters
    const validation = validateSchedule(minute, hour, day, month, dayOfWeek);
    
    if (!validation.success) {
      console.error(`Error: ${validation.error}`);
      return false;
    }
    
    if (validation.warnings && validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        console.warn(`Warning: ${warning}`);
      });
    }
    
    // Format the schedule for display
    const scheduleDisplay = `${minute} ${hour} ${day} ${month} ${dayOfWeek}`;
    console.log(`Configured schedule: ${scheduleDisplay} (minute hour day month dayofweek)`);
    console.log(`Task name: ${sanitizedTaskName}`);
    
    // Check if task already exists
    const taskExists = await checkTaskExists(sanitizedTaskName);
    if (taskExists) {
      console.log(`Task "${sanitizedTaskName}" already exists. It will be overwritten.`);
    }
    
    // Get absolute paths
    const scriptDir = path.dirname(process.argv[1]);
    const batchFilePath = path.join(scriptDir, 'run_vena_import.bat');
    
    // Create batch file with improved logging
    const batchContent = `@echo off
echo =========================================== >> "%~dp0import_log.txt"
echo Starting Vena ETL import at %date% %time% >> "%~dp0import_log.txt"
cd /d "%~dp0"
node multi_import.js run >> "%~dp0import_log.txt" 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo Import FAILED with error code %ERRORLEVEL% at %date% %time% >> "%~dp0import_log.txt"
) else (
  echo Import completed successfully at %date% %time% >> "%~dp0import_log.txt"
)
echo =========================================== >> "%~dp0import_log.txt"
`;
    
    // Security note: This is intentionally using a non-literal file path
    // The path is constructed from the script directory, not from user input
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(batchFilePath, batchContent);
    console.log(`✅ Created batch file: ${batchFilePath}`);
    
    // Create XML file for task definition
    const xmlFilePath = path.join(scriptDir, 'vena_task.xml');
    
    // Create basic XML for task
    const xmlContent = generateTaskXml(hour, minute, day, month, dayOfWeek, batchFilePath, scriptDir, timeLimit);
    
    // Security note: This is intentionally using a non-literal file path
    // The path is constructed from the script directory, not from user input
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(xmlFilePath, xmlContent);
    console.log(`✅ Created task definition: ${xmlFilePath}`);
    
    // Create command to import the task
    const importCmd = `schtasks /create /tn "${taskName}" /xml "${xmlFilePath}" /f`;
    
    console.log('\nTo create the scheduled task, run this command as Administrator:');
    console.log(importCmd);
    
    console.log('\nAlternatively, open Task Scheduler and import the XML file manually.');
    console.log('\n=== Task setup completed ===');
    
    return true;
  } catch (err) {
    console.error('Error creating scheduled task:', err.message);
    return false;
  }
}

/**
 * Generate XML for Windows Task Scheduler
 * @param {string} hour Hour to run
 * @param {string} minute Minute to run
 * @param {string} day Day to run
 * @param {string} month Month to run
 * @param {string} dayOfWeek Day of week to run
 * @param {string} batchFilePath Path to batch file
 * @param {string} scriptDir Directory of script
 * @param {string} timeLimit Execution time limit (e.g., PT1H for 1 hour)
 * @returns {string} XML content
 */
function generateTaskXml(hour, minute, day, month, dayOfWeek, batchFilePath, scriptDir, timeLimit = 'PT1H') {
  let monthXml = '';
  
  // Handle month configuration
  if (month === '*') {
    monthXml = '<January /><February /><March /><April /><May /><June /><July /><August /><September /><October /><November /><December />';
  } else {
    // Handle comma-separated months
    if (month.includes(',')) {
      const months = month.split(',');
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      monthXml = months.map(m => `<${monthNames[parseInt(m) - 1]} />`).join('');
    } else {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      monthXml = `<${monthNames[parseInt(month) - 1]} />`;
    }
  }
  
  // Handle day of week configuration
  let daysOfWeekXml = '';
  if (dayOfWeek !== '*') {
    const daysList = dayOfWeek.split(',');
    daysOfWeekXml = `
      <DaysOfWeek>
        ${daysList.includes('0') ? '<Sunday />' : ''}
        ${daysList.includes('1') ? '<Monday />' : ''}
        ${daysList.includes('2') ? '<Tuesday />' : ''}
        ${daysList.includes('3') ? '<Wednesday />' : ''}
        ${daysList.includes('4') ? '<Thursday />' : ''}
        ${daysList.includes('5') ? '<Friday />' : ''}
        ${daysList.includes('6') ? '<Saturday />' : ''}
      </DaysOfWeek>`;
  }
  
  // Generate a start date (next year to ensure it's in the future)
  const nextYear = new Date().getFullYear() + 1;
  const startDate = `${nextYear}-01-01`;
  
  // Use configured run level from settings
  const runLevel = sanitizeId(schedulerConfig.runLevel);
  
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Vena ETL Import automation</Description>
    <Author>${process.env.USERNAME || 'VenaETLTool'}</Author>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${startDate}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth>
          <Day>${day}</Day>
        </DaysOfMonth>
        <Months>
          ${monthXml}
        </Months>
        ${daysOfWeekXml}
      </ScheduleByMonth>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>${runLevel}</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>${timeLimit}</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${batchFilePath}</Command>
      <WorkingDirectory>${scriptDir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

module.exports = {
  createScheduledTask,
  checkTaskExists,
  deleteTask,
  validateSchedule
};