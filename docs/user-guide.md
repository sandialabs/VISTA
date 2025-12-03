# User Guide

Welcome to VISTA! This guide will help you get started with organizing, classifying, and collaborating on visual content.

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Projects](#projects)
4. [Images](#images)
5. [Classifications](#classifications)
6. [Comments & Collaboration](#comments--collaboration)
7. [ML Analysis](#ml-analysis)
8. [Metadata](#metadata)
9. [API Keys](#api-keys)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)

## Introduction

VISTA is a web application designed to help teams organize, classify, and collaborate on visual content. Whether you're managing a dataset for machine learning, organizing photos for a project, or collaborating with a team on visual content, this application provides the tools you need.

### Key Features

- **Project Organization** - Group images into projects with team-based access
- **Image Classification** - Apply custom labels to categorize images
- **Collaboration** - Add comments and share insights with your team
- **ML Integration** - View machine learning analysis results with interactive overlays
- **Safe Deletion** - Soft delete with recovery period before permanent removal
- **Search & Filter** - Find images quickly with filtering and search
- **API Access** - Programmatic access for automation

### Who Should Use This Guide

This guide is for end users who want to:
- Organize and manage image collections
- Classify and label images
- Collaborate with team members
- View and export ML analysis results
- Integrate with other tools via API

For technical setup and administration, see the [Admin Guide](admin-guide.md).
For development and customization, see the [Developer Guide](developer-guide.md).

## Getting Started

### Accessing the Application

1. Open your web browser and navigate to your organization's VISTA URL
2. Log in using your organization's authentication system
3. You'll see the home page with a list of projects you have access to

### User Interface Overview

**Home Page:**
- List of all projects you can access
- Create new project button
- Search and filter options

**Project View:**
- Grid of images in the project
- Upload new images
- Manage project settings
- Access project metadata

**Image View:**
- Full-size image display
- Classification controls
- Comment section
- ML analysis panel (if available)
- Image metadata

### Navigation

- **Home** - Click the logo or "Home" link to return to the project list
- **Projects** - Click a project name to view its images
- **Images** - Click an image thumbnail to view details
- **Back** - Use your browser's back button or on-screen back links

## Projects

Projects are the top-level organizational unit for your images. Each project belongs to a group, and only members of that group can access it.

### Creating a Project

1. From the home page, click "Create New Project"
2. Enter the following information:
   - **Name:** A descriptive name for your project
   - **Description:** Optional details about the project
   - **Group:** Select the group that should have access
3. Click "Create"

The new project will appear in your project list.

### Viewing Projects

**Project List:**
- Shows all projects you have access to
- Displays project name, description, and image count
- Search by name or filter by group

**Project Details:**
- Click on a project to view its images
- See project metadata and settings
- Upload new images
- Manage classifications

### Editing Projects

1. Navigate to the project
2. Click "Edit Project" or settings icon
3. Update the name, description, or metadata
4. Click "Save Changes"

### Deleting Projects

Warning: Deleting a project will delete all images within it after the retention period.

1. Navigate to the project
2. Click "Delete Project"
3. Confirm the deletion
4. The project and its images will be soft-deleted (recoverable for 60 days by default)

### Project Metadata

Add custom key-value metadata to projects:

1. Navigate to the project
2. Click "Manage Metadata"
3. Add key-value pairs (e.g., `dataset_version: 1.0`, `purpose: training`)
4. Click "Save"

Use cases:
- Track dataset versions
- Store project-specific settings
- Add custom attributes for filtering

## Images

### Uploading Images

**Single Upload:**
1. Navigate to the project
2. Click "Upload Image" or drag-and-drop
3. Select an image file (JPG, PNG, GIF supported)
4. Optionally add metadata
5. Click "Upload"

**Bulk Upload:**
1. Click "Upload Multiple"
2. Select multiple images (Ctrl/Cmd+Click)
3. All images will be uploaded to the project

**Supported Formats:**
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)

**Size Limits:**
- Maximum file size: 10 MB (configurable by administrator)

### Viewing Images

**Gallery View:**
- Grid of thumbnail images
- Hover to see quick info
- Click to view full size

**Detail View:**
- Full-size image display
- Zoom controls
- Classification panel
- Comments
- Metadata
- ML analysis (if available)

**Navigation:**
- Use arrow keys or on-screen arrows to move between images
- Click "Back to Gallery" to return to project view

### Image Information

Each image displays:
- **Filename** - Original filename
- **Upload Date** - When it was uploaded
- **Uploader** - Who uploaded it
- **File Size** - Size in MB/KB
- **Dimensions** - Width x height in pixels
- **Classifications** - Applied labels
- **Comments** - Team comments
- **Metadata** - Custom key-value pairs

### Image Metadata

Add custom metadata to individual images:

1. Navigate to the image detail view
2. Click "Edit Metadata"
3. Add key-value pairs
4. Click "Save"

Example use cases:
- `camera: Canon EOS R5`
- `location: Building A, Room 101`
- `date_captured: 2024-01-15`
- `lighting: natural`

### Downloading Images

**Single Image:**
1. View the image
2. Click "Download" or right-click > "Save As"

**Multiple Images:**
1. Select images in gallery view (checkbox selection)
2. Click "Download Selected"
3. Images will be downloaded as a ZIP file

### Deleting Images

Images use a two-stage deletion process for safety:

**Soft Delete (Recoverable):**
1. Select image(s) in gallery or detail view
2. Click "Delete"
3. Optionally provide a reason
4. Confirm deletion
5. Images are hidden but retained for 60 days

**Recovering Deleted Images:**
1. In the project, click "Show Deleted"
2. Select deleted images
3. Click "Restore"

**Hard Delete (Permanent):**
- After 60 days, soft-deleted images are permanently removed
- Administrators can force immediate hard deletion if needed
- Hard deletion cannot be undone

## Classifications

Classifications are custom labels you can apply to images to categorize and organize them.

### Creating Classification Classes

Before classifying images, create the classification classes:

1. Navigate to the project
2. Click "Manage Classes"
3. Click "Add Class"
4. Enter:
   - **Name:** Label name (e.g., "Cat", "Defect Type A")
   - **Description:** Optional details
5. Click "Create"

**Class Examples:**
- Quality control: "Pass", "Fail", "Needs Review"
- Object types: "Car", "Pedestrian", "Bicycle"
- Medical: "Normal", "Abnormal", "Unclear"
- Defects: "Scratch", "Dent", "Discoloration"

### Classifying Images

**Single Image:**
1. View the image
2. In the Classifications panel, select a class from the dropdown
3. Click "Add Classification"
4. The label will appear on the image

**Multiple Images:**
1. In gallery view, select multiple images (checkbox)
2. Click "Classify Selected"
3. Choose a class
4. Click "Apply"

**Removing Classifications:**
1. View the image
2. In the Classifications panel, click the "X" next to the classification
3. Confirm removal

### Viewing Classifications

**On Images:**
- Classifications appear as labels/tags on the image
- Multiple classifications can be applied to one image

**Filtering by Classification:**
1. In the project gallery view
2. Click "Filter"
3. Select one or more classes
4. Only images with those classifications will be shown

### Editing Classes

1. Navigate to the project
2. Click "Manage Classes"
3. Click "Edit" next to a class
4. Update name or description
5. Click "Save"

Note: Editing a class name updates it everywhere it's used.

### Deleting Classes

Warning: Deleting a class removes all classifications using that class.

1. Click "Manage Classes"
2. Click "Delete" next to the class
3. Confirm deletion
4. All instances of that classification will be removed from images

## Comments & Collaboration

Add comments to images to share insights, ask questions, or document findings with your team.

### Adding Comments

1. Navigate to the image detail view
2. Scroll to the Comments section
3. Type your comment in the text box
4. Click "Post Comment"

**Comment Tips:**
- Be specific and constructive
- Reference specific parts of the image
- Use @mentions if your system supports it
- Add relevant context

### Viewing Comments

**On Image:**
- Comments appear in chronological order
- Shows author, timestamp, and comment text
- Most recent comments at the bottom

**Comment Count:**
- Number of comments shown on image thumbnails
- Click to view all comments

### Editing Comments

1. Find your comment
2. Click "Edit" (only your own comments)
3. Update the text
4. Click "Save"

Note: Edited comments show an "Edited" indicator.

### Deleting Comments

1. Find your comment
2. Click "Delete" (only your own comments)
3. Confirm deletion

Note: Deleted comments cannot be recovered.

### Comment Best Practices

**Good Comments:**
- "The lighting in the upper-left corner appears overexposed"
- "Confirmed defect at 10:00 position, approximately 2mm"
- "This sample matches the reference image from batch 123"

**Less Helpful:**
- "Looks bad"
- "???"
- "See me"

## ML Analysis

If your organization has integrated machine learning pipelines, you can view analysis results directly in the application.

### What is ML Analysis?

ML Analysis displays the results of automated image analysis, such as:
- Object detection (bounding boxes)
- Segmentation (heatmaps)
- Classification scores
- Feature detection
- Anomaly detection

Note: Users cannot trigger ML analysis directly - it's initiated by automated pipelines or administrators.

### Viewing ML Analysis Results

1. Navigate to an image that has been analyzed
2. Look for the "ML Analysis" panel or indicator
3. Click to view available analyses

**If Multiple Analyses:**
- Select the analysis you want to view from the dropdown
- Each analysis shows the model name and timestamp

### Understanding Visualizations

**Bounding Boxes:**
- Rectangular boxes around detected objects
- Each box may have a label and confidence score
- Different colors may represent different classes

**Heatmaps:**
- Color-coded overlay showing areas of interest
- Warmer colors (red/yellow) typically indicate higher confidence
- Cooler colors (blue/green) indicate lower confidence

**Side-by-Side View:**
- Toggle to view original and analyzed images side-by-side
- Useful for comparing before and after

### Adjusting Visualization Settings

**Opacity:**
- Use the opacity slider to adjust overlay transparency
- 100% = fully opaque, 0% = invisible
- Find the right balance to see both image and analysis

**Toggle Overlays:**
- Check/uncheck boxes to show/hide specific overlays
- Useful when multiple analysis types are present

**Zoom:**
- Zoom in to see details in bounding boxes or heatmaps
- Pan around the image to explore different areas

### Exporting ML Results

**Export as JSON:**
1. View the ML analysis
2. Click "Export" > "JSON"
3. Save the file containing all annotations

**JSON Format:**
```json
{
  "analysis_id": "uuid",
  "model_name": "yolo_v8",
  "annotations": [
    {
      "type": "bounding_box",
      "class_name": "person",
      "confidence": 0.95,
      "bbox": [x, y, width, height]
    }
  ]
}
```

**Export as CSV:**
1. Click "Export" > "CSV"
2. Save the file for use in spreadsheets

Use cases:
- Further analysis in other tools
- Record keeping
- Training data generation
- Quality assurance

### Filtering by ML Results

Some implementations allow filtering by ML-detected classes:

1. In project view, click "Filter"
2. Select "ML Detected: [class name]"
3. View only images where ML detected that class

## Metadata

Metadata allows you to attach custom key-value information to projects and images.

### Project Metadata

**Adding Project Metadata:**
1. Navigate to project
2. Click "Manage Metadata"
3. Add key-value pairs
4. Click "Save"

**Use Cases:**
- Dataset versioning: `version: 2.1`
- Project settings: `target_resolution: 1920x1080`
- Tracking: `data_source: camera_array_3`
- Custom attributes: `season: winter`

### Image Metadata

**Adding Image Metadata:**
1. Navigate to image detail view
2. Click "Edit Metadata"
3. Add key-value pairs
4. Click "Save"

**Use Cases:**
- Camera settings: `iso: 400`, `aperture: f/2.8`
- Location: `latitude: 40.7128`, `longitude: -74.0060`
- Context: `temperature: 22C`, `humidity: 65%`
- Quality: `focus_score: 0.92`

### Searching by Metadata

If your deployment supports it:

1. Click "Advanced Search"
2. Add metadata filters (e.g., `location: Building A`)
3. View matching results

### Bulk Metadata Operations

**Apply to Multiple Images:**
1. Select images in gallery view
2. Click "Edit Metadata"
3. Add key-value pairs
4. Click "Apply to Selected"

This is useful for:
- Adding batch information to multiple images
- Tagging images from the same session
- Adding context to related images

### Metadata Best Practices

**Good Metadata:**
- Use consistent key names (e.g., always `camera` not sometimes `cam`)
- Use standard formats for dates (ISO 8601: `2024-01-15`)
- Be specific: `location: Building A, Floor 2, Room 201`
- Document your metadata schema

**Keys to Avoid:**
- Special characters in key names
- Very long key names
- Duplicate keys (will overwrite)

## API Keys

API keys allow programmatic access to the application for automation and integration.

### What are API Keys?

API keys authenticate requests from scripts, applications, or automated pipelines without requiring interactive login.

**Use Cases:**
- Automated image uploads
- Batch classification
- Data export scripts
- Integration with other tools
- CI/CD pipelines

### Creating API Keys

1. Click on your profile or settings
2. Select "API Keys"
3. Click "Create New API Key"
4. Enter:
   - **Name:** Descriptive name (e.g., "Upload Script", "CI Pipeline")
   - **Expiration:** Optional expiration date
5. Click "Create"
6. **Important:** Copy and save the API key immediately - it won't be shown again

### Using API Keys

**With curl:**
```bash
curl -H "X-API-Key: your-api-key-here" \
  https://your-app.example.com/api/projects
```

**With Python:**
```python
import requests

headers = {"X-API-Key": "your-api-key-here"}
response = requests.get(
    "https://your-app.example.com/api/projects",
    headers=headers
)
projects = response.json()
```

**With JavaScript:**
```javascript
const response = await fetch('/api/projects', {
  headers: {
    'X-API-Key': 'your-api-key-here'
  }
});
const projects = await response.json();
```

### Managing API Keys

**Viewing Keys:**
- See all your active API keys
- View name, creation date, last used
- Cannot view the key value after creation

**Revoking Keys:**
1. Click "Revoke" next to the key
2. Confirm revocation
3. The key will immediately stop working

**Best Practices:**
- Create separate keys for different purposes
- Use descriptive names
- Revoke unused keys
- Rotate keys periodically
- Never commit keys to version control
- Store keys securely (environment variables, secrets manager)

### API Key Security

- Treat API keys like passwords
- Don't share keys between users or systems
- If a key is compromised, revoke it immediately
- Monitor key usage for unusual activity
- Set expiration dates for temporary needs

### API Documentation

For detailed API documentation:
1. Navigate to https://your-app.example.com/docs
2. View interactive API documentation (Swagger UI)
3. Test endpoints directly in the browser
4. See request/response formats

Alternative documentation:
- ReDoc: https://your-app.example.com/redoc

## Best Practices

### Organization

**Project Structure:**
- Create separate projects for different datasets or purposes
- Use descriptive names that explain the project's purpose
- Add detailed descriptions to help team members understand the project
- Use metadata to track versions and settings

**Image Naming:**
- Use consistent naming conventions
- Include relevant information in filenames
- Avoid special characters
- Keep filenames reasonably short

**Classification Strategy:**
- Plan your classification schema before starting
- Keep class names clear and unambiguous
- Document what each class means
- Use a consistent taxonomy across related projects

### Collaboration

**Communication:**
- Use comments to document findings
- Be specific and actionable
- Respond to team members' questions
- Share context that might not be obvious

**Access Control:**
- Only add users to projects they need
- Use groups to manage access efficiently
- Review access periodically

### Data Quality

**Before Upload:**
- Check image quality (focus, lighting, resolution)
- Remove duplicates
- Verify file formats are supported
- Consider resizing very large images

**During Classification:**
- Be consistent with label application
- Review unclear cases with team
- Document edge cases
- Periodically review and correct classifications

**Regular Maintenance:**
- Review and clean up old projects
- Remove deleted images that are no longer needed
- Archive completed projects
- Update documentation and metadata

### Performance

**For Large Projects:**
- Use filtering to work with subsets of images
- Delete or archive old images you don't need
- Use pagination when viewing galleries
- Consider splitting very large projects

**Upload Efficiency:**
- Use bulk upload for multiple images
- Upload during off-peak hours if possible
- Check file sizes before upload
- Use wired connection for large uploads

### Security

**Personal Responsibility:**
- Log out when finished
- Don't share your API keys
- Report suspicious activity
- Use strong authentication (when applicable)

**Data Protection:**
- Don't upload sensitive personal information
- Follow your organization's data policies
- Verify project access is appropriate
- Report data breaches immediately

## Troubleshooting

### Common Issues

#### Images Not Loading

**Problem:** Images appear as broken links or don't display

**Solutions:**
- Refresh the page
- Check your internet connection
- Clear browser cache
- Try a different browser
- Contact administrator if problem persists

#### Can't Access a Project

**Problem:** Project doesn't appear in your list

**Solutions:**
- Verify you're a member of the project's group
- Check if the project was deleted
- Confirm with team members that the project exists
- Contact administrator to verify access

#### Upload Fails

**Problem:** Image upload doesn't complete

**Solutions:**
- Check file size (must be under limit)
- Verify file format is supported (JPG, PNG, GIF)
- Check internet connection
- Try a smaller image
- Clear browser cache and retry

#### Classifications Not Saving

**Problem:** Classifications disappear or don't save

**Solutions:**
- Check you have permission to classify
- Verify the class still exists
- Refresh the page and retry
- Check browser console for errors
- Contact administrator

#### Slow Performance

**Problem:** Application is slow or unresponsive

**Solutions:**
- Close unnecessary browser tabs
- Clear browser cache
- Try during off-peak hours
- Use filtering to reduce displayed items
- Check internet connection speed

#### Can't Delete Images

**Problem:** Delete button doesn't work or images won't delete

**Solutions:**
- Verify you have delete permission
- Check if images are already deleted (soft delete)
- Refresh the page
- Try from image detail view instead of gallery
- Contact administrator if needed

### Error Messages

**"401 Unauthorized"**
- You're not logged in or session expired
- Solution: Log in again

**"403 Forbidden"**
- You don't have permission for this action
- Solution: Contact administrator or project owner

**"404 Not Found"**
- The resource (project, image) doesn't exist or was deleted
- Solution: Verify the URL or go back to home page

**"413 Payload Too Large"**
- File is too large
- Solution: Compress image or upload smaller file

**"500 Internal Server Error"**
- Server-side error
- Solution: Refresh page, if persists contact administrator

### Getting Help

**Documentation:**
1. Check this user guide
2. Review tooltips in the application
3. Check FAQ (if available)

**Support:**
1. Contact your team lead or project administrator
2. Submit a support ticket through your organization's system
3. Include:
   - What you were trying to do
   - What happened instead
   - Error messages (take screenshot)
   - Browser and OS information

**Best Practices for Reporting Issues:**
- Be specific about the problem
- Include steps to reproduce
- Provide screenshots when helpful
- Note when the problem started
- Mention if it works in other browsers

## Tips & Tricks

### Keyboard Shortcuts

- **Arrow Keys** - Navigate between images in detail view
- **Escape** - Close modals or return to previous view
- **Ctrl/Cmd + Click** - Select multiple images
- **Shift + Click** - Select range of images

### Quick Actions

- **Double-click image** - View full screen
- **Right-click image** - Download or copy URL
- **Drag and drop** - Upload images
- **Click outside modal** - Close modal

### Filtering & Search

- Combine multiple filters for precise results
- Use wildcards in search (if supported): `image*.jpg`
- Save commonly used filters (if feature available)
- Clear filters to see all images again

### Workflow Optimization

**For Classification Tasks:**
1. Set up all classes first
2. Use keyboard shortcuts for navigation
3. Use bulk classification for obvious cases
4. Mark unclear cases for team review
5. Do a final review pass

**For Quality Control:**
1. Filter by "Not Classified"
2. Review each image systematically
3. Use comments for questions
4. Mark issues with specific classification
5. Track progress with metadata

**For Collaboration:**
1. Establish team conventions
2. Use consistent classification names
3. Comment on edge cases
4. Regular team sync meetings
5. Document decisions in project metadata

## Glossary

- **Project** - Top-level container for organizing related images
- **Image** - Individual photo or visual file in a project
- **Classification** - Label or category applied to an image
- **Class** - A type of classification (e.g., "Approved", "Cat", "Defect")
- **Comment** - Text note added to an image by a user
- **Metadata** - Custom key-value data attached to projects or images
- **ML Analysis** - Machine learning analysis results displayed on images
- **Soft Delete** - Temporary deletion with recovery period
- **Hard Delete** - Permanent deletion that cannot be undone
- **API Key** - Authentication token for programmatic access
- **Group** - Set of users with access to specific projects
- **Annotation** - ML-detected feature (bounding box, segmentation, etc.)

## Additional Resources

- Admin Guide: See your administrator for technical setup information
- Developer Guide: For API integration and customization
- API Documentation: Available at `/docs` endpoint
- Organization Policies: Consult your organization's data handling policies

---

**Need Help?**

If you have questions not covered in this guide, contact your system administrator or team lead.
