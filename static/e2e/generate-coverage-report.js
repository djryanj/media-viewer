#!/usr/bin/env node

/**
 * E2E Test Coverage Report Generator
 *
 * Analyzes E2E test specs and generates a module-by-module coverage report.
 * Can parse test files to extract tags, test counts, and module coverage.
 *
 * Usage:
 *   node e2e/generate-coverage-report.js [--json] [--markdown] [--html]
 *
 * Options:
 *   --json      Output JSON format
 *   --markdown  Output Markdown format (default)
 *   --html      Output HTML format
 *   --all       Output all formats
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SPECS_DIR = path.join(__dirname, 'specs');
const OUTPUT_DIR = path.join(__dirname, 'coverage-reports');
const FRONTEND_MODULES = [
    'app',
    'clock',
    'favorites',
    'gallery',
    'history',
    'infinite-scroll-search',
    'infinite-scroll',
    'lightbox',
    'login',
    'playlist',
    'preferences',
    'search',
    'selection',
    'session',
    'settings',
    'sw',
    'tag-clipboard',
    'tag-tooltip',
    'tags',
    'video-controls',
    'video-player',
    'wake-lock',
    'webauthn',
];

/**
 * Parse a spec file to extract metadata
 * @param {string} filePath
 * @returns {Object}
 */
function parseSpecFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);

    // Extract tags from file header and test.describe blocks
    const tags = new Set();
    const tagMatches = content.matchAll(/@(\w+)/g);
    for (const match of tagMatches) {
        tags.add(match[1]);
    }

    // Count test.describe blocks
    const describeMatches = content.match(/test\.describe\(/g);
    const describeCount = describeMatches ? describeMatches.length : 0;

    // Count individual tests
    const testMatches = content.match(/\n\s*test\(/g);
    const testCount = testMatches ? testMatches.length : 0;

    // Extract module from filename or tags
    let module = fileName.replace('.spec.js', '');

    // Determine category from directory
    const relativePath = path.relative(SPECS_DIR, filePath);
    const category = path.dirname(relativePath);

    return {
        fileName,
        filePath: relativePath,
        module,
        category: category === '.' ? 'root' : category,
        tags: Array.from(tags),
        describeCount,
        testCount,
        linesOfCode: content.split('\n').length,
    };
}

/**
 * Scan all spec files
 * @returns {Array}
 */
function scanSpecFiles() {
    const specs = [];

    function scanDirectory(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                scanDirectory(fullPath);
            } else if (entry.name.endsWith('.spec.js')) {
                specs.push(parseSpecFile(fullPath));
            }
        }
    }

    scanDirectory(SPECS_DIR);
    return specs;
}

/**
 * Analyze coverage by module
 * @param {Array} specs
 * @returns {Object}
 */
function analyzeCoverage(specs) {
    const moduleMap = new Map();

    // Initialize all modules
    for (const module of FRONTEND_MODULES) {
        moduleMap.set(module, {
            module,
            covered: false,
            specs: [],
            testCount: 0,
            tags: new Set(),
        });
    }

    // Map specs to modules
    for (const spec of specs) {
        // Check which modules this spec covers based on tags and filename
        const coveredModules = new Set();

        // Direct module match
        if (moduleMap.has(spec.module)) {
            coveredModules.add(spec.module);
        }

        // Tag-based matching
        for (const tag of spec.tags) {
            if (moduleMap.has(tag)) {
                coveredModules.add(tag);
            }
        }

        // Update coverage
        for (const moduleName of coveredModules) {
            const moduleInfo = moduleMap.get(moduleName);
            moduleInfo.covered = true;
            moduleInfo.specs.push(spec.fileName);
            moduleInfo.testCount += spec.testCount;
            spec.tags.forEach((tag) => moduleInfo.tags.add(tag));
        }
    }

    return {
        modules: Array.from(moduleMap.values()),
        totalModules: FRONTEND_MODULES.length,
        coveredModules: Array.from(moduleMap.values()).filter((m) => m.covered).length,
        totalSpecs: specs.length,
        totalTests: specs.reduce((sum, s) => sum + s.testCount, 0),
    };
}

/**
 * Generate Markdown report
 * @param {Object} coverage
 * @param {Array} specs
 * @returns {string}
 */
function generateMarkdownReport(coverage, specs) {
    const { modules, totalModules, coveredModules, totalSpecs, totalTests } = coverage;
    const coveragePercent = ((coveredModules / totalModules) * 100).toFixed(1);

    let md = '# E2E Test Coverage Report\n\n';
    md += `**Generated:** ${new Date().toISOString()}\n\n`;
    md += `## Summary\n\n`;
    md += `- **Total Modules:** ${totalModules}\n`;
    md += `- **Covered Modules:** ${coveredModules} (${coveragePercent}%)\n`;
    md += `- **Uncovered Modules:** ${totalModules - coveredModules}\n`;
    md += `- **Total Spec Files:** ${totalSpecs}\n`;
    md += `- **Total Tests:** ${totalTests}\n\n`;

    // Coverage by category
    md += `## Coverage by Category\n\n`;
    const specsByCategory = specs.reduce((acc, spec) => {
        if (!acc[spec.category]) acc[spec.category] = [];
        acc[spec.category].push(spec);
        return acc;
    }, {});

    for (const [category, categorySpecs] of Object.entries(specsByCategory)) {
        const testCount = categorySpecs.reduce((sum, s) => sum + s.testCount, 0);
        md += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
        md += `- **Spec Files:** ${categorySpecs.length}\n`;
        md += `- **Tests:** ${testCount}\n\n`;

        md += `| Spec File | Tests | Tags |\n`;
        md += `|-----------|-------|------|\n`;
        for (const spec of categorySpecs) {
            md += `| ${spec.fileName} | ${spec.testCount} | ${spec.tags.join(', ')} |\n`;
        }
        md += `\n`;
    }

    // Module coverage detail
    md += `## Module Coverage Detail\n\n`;
    md += `| Module | Status | Specs | Tests | Tags |\n`;
    md += `|--------|--------|-------|-------|------|\n`;

    const sortedModules = modules.sort((a, b) => {
        if (a.covered !== b.covered) return a.covered ? -1 : 1;
        return a.module.localeCompare(b.module);
    });

    for (const module of sortedModules) {
        const status = module.covered ? '✅ Covered' : '❌ Missing';
        const specs = module.specs.length > 0 ? module.specs.join(', ') : '-';
        const tests = module.testCount > 0 ? module.testCount : '-';
        const tags = module.tags.size > 0 ? Array.from(module.tags).join(', ') : '-';
        md += `| ${module.module} | ${status} | ${specs} | ${tests} | ${tags} |\n`;
    }

    md += `\n## Uncovered Modules\n\n`;
    const uncovered = modules.filter((m) => !m.covered);
    if (uncovered.length > 0) {
        md += `The following ${uncovered.length} modules have no E2E test coverage:\n\n`;
        for (const module of uncovered) {
            md += `- \`${module.module}\`\n`;
        }
    } else {
        md += `🎉 All modules have E2E test coverage!\n`;
    }

    md += `\n## Recommendations\n\n`;
    md += `### High Priority\n\n`;
    const highPriority = ['search', 'settings', 'playlist', 'preferences', 'webauthn'];
    const uncoveredHighPriority = uncovered.filter((m) => highPriority.includes(m.module));
    if (uncoveredHighPriority.length > 0) {
        for (const module of uncoveredHighPriority) {
            md += `- [ ] Add E2E tests for \`${module.module}\`\n`;
        }
    } else {
        md += `✅ All high-priority modules are covered\n`;
    }

    md += `\n### Medium Priority\n\n`;
    const mediumPriority = ['history', 'infinite-scroll', 'selection', 'preferences'];
    const uncoveredMediumPriority = uncovered.filter(
        (m) => mediumPriority.includes(m.module) && !uncoveredHighPriority.includes(m)
    );
    if (uncoveredMediumPriority.length > 0) {
        for (const module of uncoveredMediumPriority) {
            md += `- [ ] Add E2E tests for \`${module.module}\`\n`;
        }
    } else {
        md += `✅ All medium-priority modules are covered\n`;
    }

    md += `\n---\n\n`;
    md += `*Generated by E2E Test Coverage Report Generator*\n`;

    return md;
}

/**
 * Generate JSON report
 * @param {Object} coverage
 * @param {Array} specs
 * @returns {string}
 */
function generateJSONReport(coverage, specs) {
    return JSON.stringify(
        {
            generated: new Date().toISOString(),
            coverage,
            specs,
        },
        null,
        2
    );
}

/**
 * Generate HTML report
 * @param {Object} coverage
 * @param {Array} specs
 * @returns {string}
 */
function generateHTMLReport(coverage, specs) {
    const { modules, totalModules, coveredModules, totalSpecs, totalTests } = coverage;
    const coveragePercent = ((coveredModules / totalModules) * 100).toFixed(1);

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>E2E Test Coverage Report</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1, h2, h3 { color: #333; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .summary-item { background: white; padding: 15px; border-radius: 4px; border-left: 4px solid #4CAF50; }
        .summary-item.warning { border-left-color: #FF9800; }
        .summary-item.danger { border-left-color: #F44336; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #4CAF50; color: white; }
        tr:hover { background: #f5f5f5; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .badge.success { background: #4CAF50; color: white; }
        .badge.danger { background: #F44336; color: white; }
        .progress-bar { width: 100%; height: 30px; background: #eee; border-radius: 4px; overflow: hidden; }
        .progress-fill { height: 100%; background: #4CAF50; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; }
    </style>
</head>
<body>
    <h1>E2E Test Coverage Report</h1>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>

    <div class="summary">
        <h2>Summary</h2>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${coveragePercent}%">${coveragePercent}%</div>
        </div>
        <div class="summary-grid">
            <div class="summary-item">
                <div style="font-size: 32px; font-weight: bold;">${totalModules}</div>
                <div>Total Modules</div>
            </div>
            <div class="summary-item">
                <div style="font-size: 32px; font-weight: bold;">${coveredModules}</div>
                <div>Covered Modules</div>
            </div>
            <div class="summary-item ${totalModules - coveredModules > 5 ? 'danger' : 'warning'}">
                <div style="font-size: 32px; font-weight: bold;">${totalModules - coveredModules}</div>
                <div>Uncovered Modules</div>
            </div>
            <div class="summary-item">
                <div style="font-size: 32px; font-weight: bold;">${totalSpecs}</div>
                <div>Spec Files</div>
            </div>
            <div class="summary-item">
                <div style="font-size: 32px; font-weight: bold;">${totalTests}</div>
                <div>Total Tests</div>
            </div>
        </div>
    </div>

    <h2>Module Coverage Detail</h2>
    <table>
        <thead>
            <tr>
                <th>Module</th>
                <th>Status</th>
                <th>Specs</th>
                <th>Tests</th>
                <th>Tags</th>
            </tr>
        </thead>
        <tbody>`;

    const sortedModules = modules.sort((a, b) => {
        if (a.covered !== b.covered) return a.covered ? -1 : 1;
        return a.module.localeCompare(b.module);
    });

    for (const module of sortedModules) {
        const status = module.covered
            ? '<span class="badge success">✅ Covered</span>'
            : '<span class="badge danger">❌ Missing</span>';
        const specs = module.specs.length > 0 ? module.specs.join(', ') : '-';
        const tests = module.testCount > 0 ? module.testCount : '-';
        const tags = module.tags.size > 0 ? Array.from(module.tags).join(', ') : '-';

        html += `
            <tr>
                <td><code>${module.module}</code></td>
                <td>${status}</td>
                <td>${specs}</td>
                <td>${tests}</td>
                <td>${tags}</td>
            </tr>`;
    }

    html += `
        </tbody>
    </table>

    <h2>Spec Files by Category</h2>
    <table>
        <thead>
            <tr>
                <th>Category</th>
                <th>Spec File</th>
                <th>Tests</th>
                <th>Tags</th>
            </tr>
        </thead>
        <tbody>`;

    const specsByCategory = specs.reduce((acc, spec) => {
        if (!acc[spec.category]) acc[spec.category] = [];
        acc[spec.category].push(spec);
        return acc;
    }, {});

    for (const [category, categorySpecs] of Object.entries(specsByCategory)) {
        for (const spec of categorySpecs) {
            html += `
            <tr>
                <td>${category}</td>
                <td><code>${spec.fileName}</code></td>
                <td>${spec.testCount}</td>
                <td>${spec.tags.join(', ')}</td>
            </tr>`;
        }
    }

    html += `
        </tbody>
    </table>

    <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; text-align: center;">
        <p><em>Generated by E2E Test Coverage Report Generator</em></p>
    </footer>
</body>
</html>`;

    return html;
}

/**
 * Main function
 */
function main() {
    const args = process.argv.slice(2);
    const outputJson = args.includes('--json') || args.includes('--all');
    const outputMarkdown =
        args.includes('--markdown') || args.includes('--all') || args.length === 0;
    const outputHtml = args.includes('--html') || args.includes('--all');

    console.log('🔍 Scanning E2E test specs...');
    const specs = scanSpecFiles();
    console.log(`   Found ${specs.length} spec files`);

    console.log('📊 Analyzing coverage...');
    const coverage = analyzeCoverage(specs);
    console.log(`   ${coverage.coveredModules}/${coverage.totalModules} modules covered`);

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    if (outputMarkdown) {
        console.log('📝 Generating Markdown report...');
        const markdown = generateMarkdownReport(coverage, specs);
        const mdPath = path.join(OUTPUT_DIR, 'e2e-coverage.md');
        fs.writeFileSync(mdPath, markdown);
        console.log(`   ✅ Saved to ${mdPath}`);
    }

    if (outputJson) {
        console.log('📝 Generating JSON report...');
        const json = generateJSONReport(coverage, specs);
        const jsonPath = path.join(OUTPUT_DIR, 'e2e-coverage.json');
        fs.writeFileSync(jsonPath, json);
        console.log(`   ✅ Saved to ${jsonPath}`);
    }

    if (outputHtml) {
        console.log('📝 Generating HTML report...');
        const html = generateHTMLReport(coverage, specs);
        const htmlPath = path.join(OUTPUT_DIR, 'e2e-coverage.html');
        fs.writeFileSync(htmlPath, html);
        console.log(`   ✅ Saved to ${htmlPath}`);
    }

    console.log(`\n✨ Report generation complete!`);
    console.log(
        `\n📈 Coverage: ${coverage.coveredModules}/${coverage.totalModules} modules (${((coverage.coveredModules / coverage.totalModules) * 100).toFixed(1)}%)`
    );
    console.log(`📝 Total Tests: ${coverage.totalTests}`);
}

main();
