# Image Upload 500 Error Fix Plan

## **Root Cause Analysis**

The 500 errors are occurring because the image endpoints (`/api/images/{id}/thumbnail` and `/api/images/{id}/content`) are trying to access a recently uploaded image (ID: `9d8ae1ee-6669-4021-a5cb-146b7ad9e91b`) but the soft delete feature changes have modified how images are retrieved.

**Key Issues Identified:**

1. **Backend endpoints need soft delete awareness**: The `get_image_thumbnail` and `get_image_content` endpoints at lines 301-408 in `backend/routers/images.py` call `crud.get_data_instance()` but don't handle the new `include_deleted` parameter properly for recently uploaded images that might be marked as deleted.

2. **Frontend loading issue**: The `ImageView.js` component (line 35) calls `/api/images/{imageId}` without the `include_deleted=true` parameter, which may be needed for accessing uploaded images.

3. **UI inconsistency**: The deletion controls component exists but the main image gallery and project view may not properly handle the soft delete states.

## **Implementation Plan**

### **1. Backend Fixes (Priority: High)**
- **Problem**: Image content/thumbnail endpoints fail with 500 errors because `crud.get_data_instance()` now considers soft delete state, but endpoints don't pass `include_deleted=True` for normal image access
- **Solution**: Modify endpoints to handle soft delete logic properly - normal image viewing should include soft-deleted images, only hiding them from listings

### **2. Frontend Error Handling (Priority: High)**  
- **Problem**: Frontend doesn't gracefully handle 500 errors when loading images
- **Solution**: Add proper error handling with fallback UI and retry mechanisms in `ImageView.js` and image display components

### **3. UI Consistency Updates (Priority: Medium)**
- **Problem**: Image gallery and project views need to properly display deletion states
- **Solution**: Update `ImageGallery.js` and `Project.js` to show visual indicators for soft-deleted images and provide appropriate actions

### **4. Testing & Verification (Priority: High)**
- **Problem**: Need to ensure the upload → view workflow works correctly
- **Solution**: Test complete image lifecycle including upload, view, soft delete, restore, and force delete

This plan addresses the immediate 500 errors while ensuring the soft delete feature works cohesively across the application.