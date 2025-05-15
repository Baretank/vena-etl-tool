/**
 * Windows Task Scheduler module for Vena ETL Tool
 * Handles creation of scheduled tasks for automation
 */
const fs = require('fs');
const path = require('path');

/**
 * Create a Windows scheduled task based on .env settings
 * @returns {Promise<boolean>} Success status
 */
async function createScheduledTask() {
  try {
    console.log('\n=== Creating Windows Scheduled Task ===\n');
    
    // Read scheduling configuration from environment
    const minute = process.env.VENA_SCHEDULE_MINUTE || '0';
    const hour = process.env.VENA_SCHEDULE_HOUR || '5';
    const day = process.env.VENA_SCHEDULE_DAY || '1';
    const month = process.env.VENA_SCHEDULE_MONTH || '*';
    const dayOfWeek = process.env.VENA_SCHEDULE_DAYOFWEEK || '*';
    
    // Format the schedule for display
    const scheduleDisplay = `${minute} ${hour} ${day} ${month} ${dayOfWeek}`;
    console.log(`Configured schedule: ${scheduleDisplay} (minute hour day month dayofweek)`);
    
    // Get absolute paths
    const scriptDir = path.dirname(process.argv[1]);
    const batchFilePath = path.join(scriptDir, 'run_vena_import.bat');
    
    // Create batch file
    const batchContent = `@echo off
echo Starting Vena ETL import at %date% %time% >> "%~dp0import_log.txt"
cd /d "%~dp0"
node multi_import.js run >> "%~dp0import_log.txt" 2>&1
echo Import completed at %date% %time% >> "%~dp0import_log.txt"
`;
    
    fs.writeFileSync(batchFilePath, batchContent);
    console.log(`✅ Created batch file: ${batchFilePath}`);
    
    // Create XML file for task definition
    const taskName = 'VenaETLImport';
    const xmlFilePath = path.join(scriptDir, 'vena_task.xml');
    
    // Create basic XML for task
    const xmlContent = generateTaskXml(hour, minute, day, month, dayOfWeek, batchFilePath, scriptDir);
    
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
 * @returns {string} XML content
 */
function generateTaskXml(hour, minute, day, month, dayOfWeek, batchFilePath, scriptDir) {
  let monthXml = '';
  
  // Handle month configuration
  if (month === '*') {
    monthXml = '<January /><February /><March /><April /><May /><June /><July /><August /><September /><October /><November /><December />';
  } else {
    monthXml = `<Month>${month}</Month>`;
  }
  
  // Handle day of week configuration
  let daysOfWeekXml = '';
  if (dayOfWeek !== '*') {
    daysOfWeekXml = `
      <DaysOfWeek>
        ${dayOfWeek.includes('0') ? '<Sunday />' : ''}
        ${dayOfWeek.includes('1') ? '<Monday />' : ''}
        ${dayOfWeek.includes('2') ? '<Tuesday />' : ''}
        ${dayOfWeek.includes('3') ? '<Wednesday />' : ''}
        ${dayOfWeek.includes('4') ? '<Thursday />' : ''}
        ${dayOfWeek.includes('5') ? '<Friday />' : ''}
        ${dayOfWeek.includes('6') ? '<Saturday />' : ''}
      </DaysOfWeek>`;
  }
  
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Vena ETL Import automation</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2025-01-01T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth>
          <Day>${day}</Day>
        </DaysOfMonth>
        <Months>
          ${monthXml}
        </Months>
      </ScheduleByMonth>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
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
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
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
  createScheduledTask
};